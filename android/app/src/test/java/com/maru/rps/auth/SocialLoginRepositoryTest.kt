package com.maru.rps.auth

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SocialLoginRepositoryTest {

    private val repository = FakeSocialLoginRepository()

    @Test
    fun `login success returns social user`() = runTest {
        repository.shouldSuccess = true
        val result = repository.login(SocialProvider.KAKAO)
        
        assertTrue(result.isSuccess)
        val user = result.getOrNull()
        assertEquals(SocialProvider.KAKAO, user?.provider)
        assertEquals("test-user-id", user?.id)
        assertEquals("test@example.com", user?.email)
    }

    @Test
    fun `login failure returns exception`() = runTest {
        repository.shouldSuccess = false
        val result = repository.login(SocialProvider.GOOGLE)
        
        assertTrue(result.isFailure)
        assertEquals("Login failed", result.exceptionOrNull()?.message)
    }
}
