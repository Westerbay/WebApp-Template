use crate::{mail::CapturedMail, settings::Environment};
use better_auth::{AuthError, AuthResult};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
};
use std::time::Duration;

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

#[derive(Clone)]
pub struct SmtpSender {
    settings: SmtpSettings,
    transport: AsyncSmtpTransport<Tokio1Executor>,
}

impl SmtpSender {
    pub fn new(settings: SmtpSettings) -> AuthResult<Self> {
        settings.validate()?;
        let builder = match (settings.mode, settings.secure) {
            (EmailMode::Capture, _) => {
                AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&settings.host)
            }
            (_, true) => AsyncSmtpTransport::<Tokio1Executor>::relay(&settings.host)
                .map_err(|_| invalid())?,
            (_, false) => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&settings.host)
                .map_err(|_| invalid())?,
        };
        let mut builder = builder
            .port(settings.port)
            .timeout(Some(Duration::from_secs(10)));
        if let (Some(username), Some(password)) = (&settings.username, &settings.password) {
            builder = builder.credentials(Credentials::new(username.clone(), password.clone()));
        }
        Ok(Self {
            settings,
            transport: builder.build(),
        })
    }

    pub async fn send(&self, mail: &CapturedMail) -> Result<(), &'static str> {
        if self.settings.environment == Environment::Staging
            && self.settings.mode == EmailMode::Smtp
            && !self
                .settings
                .allowed_recipients
                .iter()
                .any(|recipient| recipient.eq_ignore_ascii_case(&mail.to))
        {
            return Err("EMAIL_RECIPIENT_NOT_ALLOWED");
        }
        let message = Message::builder()
            .from(
                self.settings
                    .from
                    .parse()
                    .map_err(|_| "EMAIL_CONFIGURATION_INVALID")?,
            )
            .to(mail.to.parse().map_err(|_| "EMAIL_RECIPIENT_INVALID")?)
            .subject(&mail.subject)
            .multipart(
                MultiPart::alternative()
                    .singlepart(SinglePart::plain(mail.text.clone()))
                    .singlepart(SinglePart::html(mail.html.clone())),
            )
            .map_err(|_| "EMAIL_RENDER_FAILED")?;
        tokio::time::timeout(Duration::from_secs(10), self.transport.send(message))
            .await
            .map_err(|_| "EMAIL_TIMEOUT")?
            .map_err(|_| "EMAIL_DELIVERY_FAILED")?;
        Ok(())
    }
}

fn invalid() -> AuthError {
    AuthError::config("Invalid email environment")
}
