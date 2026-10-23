use super::environment::Environment;
use better_auth::{AuthError, AuthResult};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EmailMode {
    Memory,
    Capture,
    Smtp,
}

#[derive(Clone)]
pub struct SmtpSettings {
    pub environment: Environment,
    pub mode: EmailMode,
    pub from: String,
    pub host: String,
    pub port: u16,
    pub secure: bool,
    pub username: Option<String>,
    pub password: Option<String>,
    pub allowed_recipients: Vec<String>,
}

impl SmtpSettings {
    pub fn memory() -> Self {
        Self {
            environment: Environment::Test,
            mode: EmailMode::Memory,
            from: "no-reply@example.test".into(),
            host: "localhost".into(),
            port: 1025,
            secure: false,
            username: None,
            password: None,
            allowed_recipients: Vec::new(),
        }
    }
    pub fn capture(host: &str, port: u16) -> Self {
        Self {
            mode: EmailMode::Capture,
            host: host.into(),
            port,
            ..Self::memory()
        }
    }
    pub fn validate(&self) -> AuthResult<()> {
        if self.port == 0
            || self.host.trim().is_empty()
            || self.from.parse::<lettre::Address>().is_err()
        {
            return Err(invalid());
        }
        if self.mode == EmailMode::Memory && self.environment != Environment::Test {
            return Err(invalid());
        }
        if self.mode == EmailMode::Capture
            && !matches!(
                self.host.as_str(),
                "localhost" | "127.0.0.1" | "::1" | "mailpit"
            )
        {
            return Err(invalid());
        }
        if self.mode == EmailMode::Smtp
            && matches!(
                self.environment,
                Environment::Development | Environment::Test
            )
        {
            return Err(invalid());
        }
        if self.environment == Environment::Production
            && (self.mode != EmailMode::Smtp
                || self.username.as_deref().is_none_or(str::is_empty)
                || self.password.as_deref().is_none_or(str::is_empty))
        {
            return Err(invalid());
        }
        if self.environment == Environment::Staging
            && self.mode == EmailMode::Smtp
            && self.allowed_recipients.is_empty()
        {
            return Err(invalid());
        }
        if self.username.is_some() != self.password.is_some() {
            return Err(invalid());
        }
        if self
            .allowed_recipients
            .iter()
            .any(|email| email.parse::<lettre::Address>().is_err())
        {
            return Err(invalid());
        }
        Ok(())
    }
}

fn invalid() -> AuthError {
    AuthError::config("Invalid email environment")
}
