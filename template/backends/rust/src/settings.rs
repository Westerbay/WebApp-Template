use better_auth::AuthConfig;
use chrono::Duration;
use rand::{Rng, distributions::Alphanumeric};

pub const WEB_ORIGIN: &str = "http://localhost:3000";
pub const API_ORIGIN: &str = "http://localhost:4100";
pub const AUTH_PATH: &str = "/api/auth";
pub const PASSWORD_MIN_LENGTH: usize = 8;
pub const PASSWORD_MAX_LENGTH: usize = 128;
pub const VERIFICATION_HOURS: i64 = 24;
pub const RESET_HOURS: i64 = 1;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Development,
    Test,
    Staging,
    Production,
}

impl Environment {
    pub fn checks_passwords(self) -> bool {
        matches!(self, Self::Staging | Self::Production)
    }
}

pub fn local() -> AuthConfig {
    // Ephemeral local server only: no environment files or persisted credentials.
    let secret: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    AuthConfig::new(secret)
        .base_url(format!("{API_ORIGIN}{AUTH_PATH}"))
        .base_path(AUTH_PATH)
        .trusted_origin(WEB_ORIGIN)
        .session_expires_in(Duration::days(7))
        .session_update_age(Duration::days(1))
        .password_min_length(PASSWORD_MIN_LENGTH)
        .password_max_length(PASSWORD_MAX_LENGTH)
}
