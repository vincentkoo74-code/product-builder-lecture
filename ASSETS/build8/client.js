/*
 * Build8.1.2 마이그레이션 — 클라이언트 코어 (Path 1, M1).
 *
 * 책임:
 *   1) Build8Auth   — Firebase 초기화 + Anonymous 로그인 + ID 토큰 발급/갱신 (compat SDK 전역 `firebase`).
 *   2) APIClient    — POST /v1/auth/session (Bearer ID토큰) → profile.
 *   3) GameSocket   — wss /v1/ws 연결, auth 핸드셰이크(auth.ok 전 송신 큐잉), 메시지 디스패치,
 *                     재연결/하트비트, 송신 헬퍼(room.create/join/ready/start/mp.move/...).
 *   4) Build8Test   — Anonymous → session → ws auth.ok → room.create 왕복(연결성 스모크).
 *
 * 원칙(ADR-001): 클라이언트는 승패를 계산하지 않는다. 서버 메시지를 표시/중계만 한다.
 * 기존 Supabase/로그인/게임 코드는 건드리지 않는다 — 본 모듈은 나란히 추가되는 격리 레이어다.
 *
 * 이 파일은 WebView <script> 로 로드되는 클래식 스크립트다(번들러 없음). 전역 `window.Build8` 노출.
 */
(function () {
  "use strict";

  var CFG = window.__BUILD8_FIREBASE_CONFIG__;
  var ENDPOINTS = window.__BUILD8_ENDPOINTS__ || {
    restBase: "https://rps-online-server.fly.dev",
    wsUrl: "wss://rps-online-server.fly.dev/v1/ws",
  };

  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[build8]");
    console.log.apply(console, args);
  }

  // ── 1) Build8Auth — Firebase Anonymous ──────────────────────────────────────
  var Build8Auth = {
    _app: null,
    _ready: false,

    init: function () {
      if (this._ready) return true;
      if (typeof firebase === "undefined" || !firebase.initializeApp) {
        throw new Error("Firebase compat SDK 미로드 (firebase-app/auth-compat.js)");
      }
      if (!window.__BUILD8_CONFIG_READY__) {
        throw new Error("Firebase config 미설정 — ASSETS/build8/firebase-config.js 를 채우세요");
      }
      this._app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(CFG);
      // WKWebView 영속화: IndexedDB 우선, 실패 시 메모리 폴백.
      try {
        firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch (e) {
        try { firebase.auth().setPersistence(firebase.auth.Auth.Persistence.NONE); } catch (e2) {}
      }
      this._ready = true;
      return true;
    },

    /** 익명 로그인(이미 로그인돼 있으면 현재 유저 사용). returns Promise<user>. */
    signInAnonymously: function () {
      this.init();
      var auth = firebase.auth();
      if (auth.currentUser) return Promise.resolve(auth.currentUser);
      return auth.signInAnonymously().then(function (cred) { return cred.user; });
    },

    /** Firebase ID 토큰(만료 임박 시 자동 갱신, forceRefresh 가능). returns Promise<string>. */
    getIdToken: function (forceRefresh) {
      var auth = firebase.auth();
      if (!auth.currentUser) return Promise.reject(new Error("로그인 필요"));
      return auth.currentUser.getIdToken(!!forceRefresh);
    },

    currentUid: function () {
      var auth = firebase.auth();
      return auth.currentUser ? auth.currentUser.uid : null;
    },
  };

  // ── 2) APIClient — REST /v1/auth/session ────────────────────────────────────
  var APIClient = {
    /** 토큰 검증 + users upsert + profile. returns Promise<{session,profile}>. */
    session: function () {
      return Build8Auth.getIdToken(false).then(function (token) {
        return fetch(ENDPOINTS.restBase + "/v1/auth/session", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        });
      }).then(function (res) {
        if (!res.ok) throw new Error("/v1/auth/session HTTP " + res.status);
        return res.json();
      });
    },
  };

  // ── 3) GameSocket — wss /v1/ws ──────────────────────────────────────────────
  function GameSocket() {
    this.ws = null;
    this.authed = false;
    this._queue = [];          // auth.ok 전 송신 큐
    this._handlers = {};       // type -> [fn]
    this._pingTimer = null;
    this._roomId = null;       // 재접속 컨텍스트
    this._sessionId = null;
    this._closedByUs = false;
  }

  GameSocket.prototype.on = function (type, fn) {
    (this._handlers[type] = this._handlers[type] || []).push(fn);
    return this;
  };

  GameSocket.prototype._emit = function (type, data) {
    var hs = this._handlers[type] || [];
    for (var i = 0; i < hs.length; i++) {
      try { hs[i](data); } catch (e) { log("handler 오류", type, e); }
    }
    var anys = this._handlers["*"] || [];
    for (var j = 0; j < anys.length; j++) {
      try { anys[j]({ type: type, data: data }); } catch (e2) {}
    }
  };

  /** 연결 + 인증. returns Promise (auth.ok 시 resolve). */
  GameSocket.prototype.connect = function () {
    var self = this;
    self._closedByUs = false;
    return Build8Auth.getIdToken(false).then(function (token) {
      return new Promise(function (resolve, reject) {
        var ws = new WebSocket(ENDPOINTS.wsUrl);
        self.ws = ws;
        var settled = false;

        ws.onopen = function () {
          ws.send(JSON.stringify({ type: "auth", data: { token: token } }));
        };
        ws.onmessage = function (ev) {
          var msg;
          try { msg = JSON.parse(ev.data); } catch (e) { return; }
          if (msg.type === "auth.ok") {
            self.authed = true;
            self._flush();
            self._startPing();
            self._emit("auth.ok", msg.data);
            if (!settled) { settled = true; resolve(msg.data); }
            return;
          }
          if (msg.type === "error" && msg.data && String(msg.data.code || "").indexOf("AUTH") === 0) {
            if (!settled) { settled = true; reject(new Error("WS auth 실패: " + msg.data.code)); }
          }
          // 멀티 컨텍스트 추적(재접속용)
          if (msg.data && msg.data.roomId) self._roomId = msg.data.roomId;
          if (msg.data && msg.data.sessionId) self._sessionId = msg.data.sessionId;
          if (msg.type === "mp.host.changed" && msg.data && msg.data.newSessionId) {
            self._sessionId = msg.data.newSessionId;
          }
          self._emit(msg.type, msg.data);
        };
        ws.onerror = function (e) {
          if (!settled) { settled = true; reject(new Error("WS 연결 오류")); }
        };
        ws.onclose = function () {
          self.authed = false;
          self._stopPing();
          self._emit("__closed__", {});
          // M1: 자동 재연결은 통합 단계(M4)에서 활성화. 여기선 이벤트만.
        };
      });
    });
  };

  GameSocket.prototype._send = function (type, data) {
    var payload = JSON.stringify({ type: type, data: data || {} });
    if (this.authed && this.ws && this.ws.readyState === 1) {
      this.ws.send(payload);
    } else {
      this._queue.push(payload); // auth.ok 전 큐잉
    }
  };

  GameSocket.prototype._flush = function () {
    while (this._queue.length && this.ws && this.ws.readyState === 1) {
      this.ws.send(this._queue.shift());
    }
  };

  GameSocket.prototype._startPing = function () {
    var self = this;
    this._stopPing();
    this._pingTimer = setInterval(function () {
      if (self.ws && self.ws.readyState === 1) {
        try { self.ws.send(JSON.stringify({ type: "ping", data: {} })); } catch (e) {}
      }
    }, 30000);
  };
  GameSocket.prototype._stopPing = function () {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  };

  // 송신 헬퍼 (서버 lobbyRouter 계약)
  GameSocket.prototype.roomCreate = function (o) { this._send("room.create", o || {}); };
  GameSocket.prototype.roomJoin = function (roomCode, displayName) { this._send("room.join", { roomCode: roomCode, displayName: displayName }); };
  GameSocket.prototype.roomReady = function (roomId) { this._send("room.ready", { roomId: roomId }); };
  GameSocket.prototype.roomStart = function (roomId) { this._send("room.start", { roomId: roomId }); };
  GameSocket.prototype.mpMove = function (roomId, roundNo, replayNo, move) {
    this._send("mp.move", { roomId: roomId, roundNo: roundNo, replayNo: replayNo, move: move });
  };
  GameSocket.prototype.roomLeave = function (roomId) { this._send("room.leave", { roomId: roomId }); };
  GameSocket.prototype.hostDestroy = function (roomId) { this._send("host.destroy", { roomId: roomId }); };
  GameSocket.prototype.mpReconnect = function (roomId) { this._send("mp.reconnect", { roomId: roomId || this._roomId }); };

  GameSocket.prototype.close = function () {
    this._closedByUs = true;
    this._stopPing();
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
  };

  // ── 4) Build8Test — 연결성 스모크 (수동 호출) ───────────────────────────────
  // 콘솔/디버그에서 window.Build8.test() 로 실행. 기존 화면을 건드리지 않는다.
  function test() {
    log("스모크 시작: anonymous → session → ws auth.ok → room.create");
    var sock = new GameSocket();
    sock.on("room.created", function (d) { log("✅ room.created:", d.roomCode, d.roomId); });
    sock.on("mp.lobby.update", function (d) { log("lobby.update participants:", (d.participants || []).length); });
    sock.on("error", function (d) { log("⚠️ server error:", d.code, d.message); });
    return Build8Auth.signInAnonymously()
      .then(function (u) { log("anonymous uid:", u.uid); return APIClient.session(); })
      .then(function (s) { log("✅ /v1/auth/session profile:", s.profile); return sock.connect(); })
      .then(function (ok) { log("✅ ws auth.ok uid:", ok.uid); sock.roomCreate({ displayName: "M1-smoke", maxParticipants: 4, targetLosers: 1 }); return sock; })
      .catch(function (e) { log("❌ 스모크 실패:", e && e.message ? e.message : e); throw e; });
  }

  window.Build8 = {
    Auth: Build8Auth,
    API: APIClient,
    GameSocket: GameSocket,
    newSocket: function () { return new GameSocket(); },
    test: test,
    endpoints: ENDPOINTS,
  };
  log("client.js 로드됨 (configReady=" + (!!window.__BUILD8_CONFIG_READY__) + ")");
})();
