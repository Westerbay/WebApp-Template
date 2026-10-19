use crate::infrastructure::auth::hibp::PasswordCheck;
use argon2::{
    Argon2, PasswordHasher as ArgonHasher, PasswordVerifier,
    password_hash::{PasswordHash, SaltString, rand_core::OsRng},
};
use async_trait::async_trait;
use better_auth::{AuthError, AuthResult};
use better_auth_core::PasswordHasher;

/// Preserve exact input bytes, including whitespace and Unicode composition.
/// Argon2 runs off the async executor; its library defaults are retained.
#[derive(Default)]
pub struct ExactPasswordHasher {
    pub check: PasswordCheck,
}

#[async_trait]
impl PasswordHasher for ExactPasswordHasher {
    async fn hash(&self, password: &str) -> AuthResult<String> {
        // Reset tokens are consumed atomically by the upstream handler before
        // this hook, so a rejection or outage requires a fresh reset link.
        self.check.validate(password).await?;
        let password = password.to_owned();
        tokio::task::spawn_blocking(move || {
            Argon2::default()
                .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
                .map(|hash| hash.to_string())
                .map_err(|_| AuthError::internal("Password hashing failed"))
        })
        .await
        .map_err(|_| AuthError::internal("Password worker failed"))?
    }

    async fn verify(&self, hash: &str, password: &str) -> AuthResult<bool> {
        let (hash, password) = (hash.to_owned(), password.to_owned());
        tokio::task::spawn_blocking(move || {
            let parsed = PasswordHash::new(&hash)
                .map_err(|_| AuthError::internal("Invalid password hash"))?;
            Ok(Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok())
        })
        .await
        .map_err(|_| AuthError::internal("Password worker failed"))?
    }
}
