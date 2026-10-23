use super::mail::CapturedMail;
use crate::config::{
    email::{EmailMode, SmtpSettings},
    environment::Environment,
};
use better_auth::{AuthError, AuthResult};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
};
use std::time::Duration;

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
