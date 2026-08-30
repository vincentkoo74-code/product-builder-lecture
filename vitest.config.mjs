// Build42: headless Chrome 계측 suite(build37-a5/build38/build39×2/build41/build42)가 병렬로 뜨면 서로를 기다리며
// beforeAll 600s 를 넘긴다(실측: 전체 실행에서 5개 모두 hook timeout, 단독/순차 실행은 20~100s). 파일 병렬을 끈다.
// 비-Chrome suite 는 수 초라 총 시간은 오히려 줄어든다. include/known-red 분리는 기본값 그대로.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { fileParallelism: false } });
