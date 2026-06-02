package com.maru.rps.auth

enum class SocialProvider {
    KAKAO, LINE, APPLE, GOOGLE
}

data class SocialUser(
    val provider: SocialProvider,
    val id: String,
    val email: String?
)

interface SocialLoginRepository {
    suspend fun login(provider: SocialProvider): Result<SocialUser>
}

class FakeSocialLoginRepository : SocialLoginRepository {

    var shouldSuccess = true

    override suspend fun login(provider: SocialProvider): Result<SocialUser> {
        return if (shouldSuccess) {
            Result.success(
                SocialUser(
                    provider = provider,
                    id = "test-user-id",
                    email = "test@example.com"
                )
            )
        } else {
            Result.failure(Exception("Login failed"))
        }
    }
}
