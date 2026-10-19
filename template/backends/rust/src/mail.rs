//! Capture test messages and dispatch SMTP without promising delivery to callers.
use crate::{
    settings::{self, Environment},
    smtp::{EmailMode, SmtpSender, SmtpSettings},
};
use async_trait::async_trait;
use better_auth::{
    AuthError, AuthResult,
    plugins::{SendResetPassword, SendVerificationEmail},
    wire::UserView,
};
use serde::Deserialize;
use std::{collections::HashMap, sync::Arc};
use tokio::{sync::Mutex, task::JoinSet};
use url::Url;

#[derive(Clone, Debug)]
pub struct CapturedMail {
    pub kind: &'static str,
    pub to: String,
    pub url: String,
    pub locale: &'static str,
    pub subject: String,
    pub html: String,
    pub text: String,
}

#[derive(Clone)]
pub struct Mailbox {
    messages: Arc<Mutex<Vec<CapturedMail>>>,
    tasks: Arc<Mutex<JoinSet<Result<(), &'static str>>>>,
    sender: Option<SmtpSender>,
    web_origin: Url,
    default_locale: &'static str,
    environment: Environment,
}

impl Default for Mailbox {
    fn default() -> Self {
        Self::new(settings::WEB_ORIGIN, "en", SmtpSettings::memory())
            .expect("valid local mail configuration")
    }
}

impl Mailbox {
    pub fn new(
        web_origin: &str,
        default_locale: &'static str,
        settings: SmtpSettings,
    ) -> AuthResult<Self> {
        settings.validate()?;
        if !matches!(default_locale, "en" | "fr") {
            return Err(AuthError::config("Unsupported mail locale"));
        }
        let environment = settings.environment;
        let sender = if settings.mode == EmailMode::Memory {
            None
        } else {
            Some(SmtpSender::new(settings)?)
        };
        Ok(Self {
            messages: Arc::default(),
            tasks: Arc::new(Mutex::new(JoinSet::new())),
            sender,
            web_origin: Url::parse(web_origin)
                .map_err(|_| AuthError::config("Invalid web origin"))?,
            default_locale,
            environment,
        })
    }
    pub fn environment(&self) -> Environment {
        self.environment
    }
    pub async fn messages(&self) -> Vec<CapturedMail> {
        self.messages.lock().await.clone()
    }

    pub async fn drain(&self) -> Result<(), &'static str> {
        let mut tasks = self.tasks.lock().await;
        let mut failed = false;
        while let Some(result) = tasks.join_next().await {
            if !matches!(result, Ok(Ok(()))) {
                failed = true;
            }
        }
        if failed {
            Err("EMAIL_DELIVERY_FAILED")
        } else {
            Ok(())
        }
    }

    async fn capture(&self, kind: &'static str, to: &str, url: &str) -> AuthResult<()> {
        let action = Url::parse(url).map_err(|_| AuthError::internal("Invalid action URL"))?;
        let callback = action
            .query_pairs()
            .find(|(key, _)| key == "callbackURL")
            .map(|(_, value)| value.into_owned());
        let locale = callback
            .and_then(|value| self.web_origin.join(&value).ok())
            .filter(|url| url.origin() == self.web_origin.origin())
            .map(|url| {
                if url.path().starts_with("/fr/")
                    || matches!(url.path(), "/adresse-confirmee" | "/nouveau-mot-de-passe")
                {
                    "fr"
                } else if url.path().starts_with("/en/") {
                    "en"
                } else {
                    self.default_locale
                }
            })
            .unwrap_or(self.default_locale);
        let mail = render(kind, to, url, locale)?;
        if self.environment == Environment::Test {
            self.messages.lock().await.push(mail.clone());
        }
        if let Some(sender) = self.sender.clone() {
            let mut tasks = self.tasks.lock().await;
            while let Some(result) = tasks.try_join_next() {
                if !matches!(result, Ok(Ok(()))) {
                    tracing::warn!(event = "email.failed", "Background email delivery failed");
                }
            }
            tasks.spawn(async move {
                let result = sender.send(&mail).await;
                if let Err(code) = result {
                    tracing::warn!(
                        event = "email.failed",
                        code,
                        "Background email delivery failed"
                    );
                }
                result
            });
        }
        Ok(())
    }
}

#[async_trait]
impl SendVerificationEmail for Mailbox {
    async fn send(&self, user: &UserView, url: &str, _token: &str) -> AuthResult<()> {
        self.capture(
            "verification",
            user.email
                .as_deref()
                .ok_or_else(|| AuthError::internal("Missing email"))?,
            url,
        )
        .await
    }
}
#[async_trait]
impl SendResetPassword for Mailbox {
    async fn send(&self, user: &serde_json::Value, url: &str, _token: &str) -> AuthResult<()> {
        let email = user
            .get("email")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| AuthError::internal("Missing email"))?;
        self.capture("reset", email, url).await
    }
}

#[derive(Deserialize)]
struct Catalog {
    email_verify_subject: String,
    email_verify_body: String,
    email_verify_action: String,
    email_reset_subject: String,
    email_reset_body: String,
    email_reset_action: String,
    email_expiry: Vec<Plural>,
    email_fallback: String,
}
#[derive(Deserialize)]
struct Plural {
    r#match: HashMap<String, String>,
}

fn render(
    kind: &'static str,
    to: &str,
    url: &str,
    locale: &'static str,
) -> AuthResult<CapturedMail> {
    let source = if locale == "fr" {
        include_str!("../assets/email.fr.json")
    } else {
        include_str!("../assets/email.en.json")
    };
    let catalog: Catalog = serde_json::from_str(source)?;
    let (subject, body, action, hours) = if kind == "verification" {
        (
            catalog.email_verify_subject,
            catalog.email_verify_body,
            catalog.email_verify_action,
            settings::VERIFICATION_HOURS,
        )
    } else {
        (
            catalog.email_reset_subject,
            catalog.email_reset_body,
            catalog.email_reset_action,
            settings::RESET_HOURS,
        )
    };
    let selector = if hours == 1 {
        "count=one"
    } else {
        "count=other"
    };
    let expiry = catalog
        .email_expiry
        .first()
        .and_then(|plural| plural.r#match.get(selector))
        .ok_or_else(|| AuthError::internal("Missing email translation"))?
        .replace("{hours}", &hours.to_string());
    let text = format!(
        "{subject}\n\n{body}\n\n{action}: {url}\n\n{expiry}\n\n{}\n{url}",
        catalog.email_fallback
    );
    let html = format!(
        "<!doctype html><html lang=\"{locale}\"><head><meta charset=\"utf-8\"><title>{subject}</title></head><body style=\"font-family:Arial,sans-serif;background-color:#f6f6f6;color:#18181b\"><main style=\"background-color:#fff;padding:32px;margin:32px auto;max-width:480px\"><h1>{subject}</h1><p>{body}</p><p><a href=\"{url}\" style=\"background-color:#18181b;color:#fff;padding:14px 20px;border-radius:6px\">{action}</a></p><p>{expiry}</p><p>{fallback}</p><p style=\"word-break:break-all\">{url}</p></main></body></html>",
        subject = escape(&subject),
        body = escape(&body),
        url = escape(url),
        action = escape(&action),
        expiry = escape(&expiry),
        fallback = escape(&catalog.email_fallback)
    );
    Ok(CapturedMail {
        kind,
        to: to.into(),
        url: url.into(),
        locale,
        subject,
        html,
        text,
    })
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
