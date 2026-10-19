//! Deployment configuration is validated before opening sockets or connecting.
use crate::{
    config::email::{EmailMode, SmtpSettings},
    config::{auth as settings, environment::Environment},
};
use better_auth::AuthConfig;
use chrono::Duration;
use std::net::SocketAddr;
use url::Url;

type ConfigResult<T> = Result<T, &'static str>;

pub struct DatabaseSettings {
    pub environment: Environment,
    pub(crate) url: Url,
    local_identity_verified: bool,
}

impl DatabaseSettings {
    pub fn from_values(get: &impl Fn(&str) -> Option<String>) -> ConfigResult<Self> {
        let environment = match get("APP_ENV").as_deref() {
            Some("development") => Environment::Development,
            Some("test") => Environment::Test,
            Some("staging") => Environment::Staging,
            Some("production") => Environment::Production,
            _ => return Err("APP_ENV_INVALID"),
        };
        let mut url =
            Url::parse(&required(get, "DATABASE_URL")?).map_err(|_| "DATABASE_URL_INVALID")?;
        if !matches!(url.scheme(), "postgres" | "postgresql")
            || url.host_str().is_none()
            || url.username().is_empty()
            || url.path().len() < 2
            || url.path()[1..].contains('/')
            || url.fragment().is_some()
        {
            return Err("DATABASE_URL_INVALID");
        }
        if url.host_str().is_some_and(|host| host.contains('%'))
            || url.query_pairs().any(|(key, _)| {
                !matches!(
                    key.as_ref(),
                    "sslmode"
                        | "sslrootcert"
                        | "sslcert"
                        | "sslkey"
                        | "application_name"
                        | "options"
                )
            })
        {
            return Err("DATABASE_URL_PARAMETERS_INVALID");
        }
        // SQLx otherwise inherits PGPORT when the URL omits its port.
        url.set_port(Some(url.port().unwrap_or(5432)))
            .map_err(|_| "DATABASE_URL_INVALID")?;
        let ssl_modes: Vec<_> = url
            .query_pairs()
            .filter(|(key, _)| key == "sslmode")
            .map(|(_, value)| value.into_owned())
            .collect();
        if environment.checks_passwords() && ssl_modes != ["verify-full"] {
            return Err("DATABASE_TLS_VERIFY_FULL_REQUIRED");
        }
        let local_identity_verified = if environment == Environment::Development {
            let mut expected = url.clone();
            let user = get("POSTGRES_USER").unwrap_or_else(|| "webapp_template_rust".into());
            let password =
                get("POSTGRES_PASSWORD").unwrap_or_else(|| "webapp_template_rust_dev".into());
            let database = get("POSTGRES_DB").unwrap_or_else(|| "webapp_template_rust".into());
            let port: u16 = get("POSTGRES_PORT")
                .unwrap_or_else(|| "5434".into())
                .parse()
                .map_err(|_| "POSTGRES_PORT_INVALID")?;
            expected
                .set_username(&user)
                .map_err(|_| "POSTGRES_USER_INVALID")?;
            expected
                .set_password(Some(&password))
                .map_err(|_| "POSTGRES_PASSWORD_INVALID")?;
            expected.set_path(&format!("/{database}"));
            url.username() == expected.username()
                && url.password() == expected.password()
                && url.path() == expected.path()
                && url.port().unwrap_or(5432) == port
        } else {
            environment == Environment::Test
                && url.username() == "prototype"
                && url.password() == Some("prototype")
                && url.path() == "/rust_auth_prototype"
                && url.port().unwrap_or(5432) == 5432
                && get("DATABASE_TEST_OWNED")
                    .is_some_and(|name| name.starts_with("skull-rust-runtime-"))
        };
        Ok(Self {
            environment,
            url,
            local_identity_verified,
        })
    }

    /// No implicit schema mutation, including when someone runs the wrong CLI.
    pub fn authorize_migration(
        &self,
        target: Option<&str>,
        fixture_mode: Option<&str>,
    ) -> ConfigResult<()> {
        let local = matches!(
            self.url.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]")
        ) && self.local_identity_verified
            && !self.environment.checks_passwords()
            && fixture_mode == Some("enabled");
        let expected = format!(
            "{}:{}/{}",
            self.url.host_str().unwrap_or_default(),
            self.url.port().unwrap_or(5432),
            self.url.path().trim_start_matches('/')
        );
        if local || (self.environment.checks_passwords() && target == Some(expected.as_str())) {
            Ok(())
        } else {
            Err("MIGRATION_TARGET_NOT_AUTHORIZED")
        }
    }
}

pub struct RuntimeSettings {
    pub database: DatabaseSettings,
    pub bind: SocketAddr,
    pub auth: AuthConfig,
    pub smtp: SmtpSettings,
    pub web_origin: String,
    pub base_locale: &'static str,
}

impl RuntimeSettings {
    pub fn from_values(get: &impl Fn(&str) -> Option<String>) -> ConfigResult<Self> {
        let database = DatabaseSettings::from_values(get)?;
        let secure = database.environment.checks_passwords();
        let api = origin(&required(get, "BETTER_AUTH_URL")?, secure)?;
        let web = origin(&required(get, "WEB_URL")?, secure)?;
        let secret = required(get, "BETTER_AUTH_SECRET")?;
        if secret.len() < 32 || secret.to_ascii_lowercase().contains("replace-with") {
            return Err("BETTER_AUTH_SECRET_INVALID");
        }
        let host = get("API_HOST").unwrap_or_else(|| "127.0.0.1".into());
        let port = get("API_PORT").unwrap_or_else(|| "3001".into());
        let bind: SocketAddr = format!("{host}:{port}")
            .parse()
            .map_err(|_| "API_BIND_INVALID")?;
        if bind.port() == 0 {
            return Err("API_BIND_INVALID");
        }
        let mode = match required(get, "EMAIL_MODE")?.as_str() {
            "capture" => EmailMode::Capture,
            "smtp" => EmailMode::Smtp,
            _ => return Err("EMAIL_MODE_INVALID"),
        };
        let smtp = SmtpSettings {
            environment: database.environment,
            mode,
            from: required(get, "EMAIL_FROM")?,
            host: required(get, "SMTP_HOST")?,
            port: required(get, "SMTP_PORT")?
                .parse()
                .map_err(|_| "SMTP_PORT_INVALID")?,
            secure: match required(get, "SMTP_SECURE")?.as_str() {
                "true" => true,
                "false" => false,
                _ => return Err("SMTP_SECURE_INVALID"),
            },
            username: get("SMTP_USER"),
            password: get("SMTP_PASSWORD"),
            allowed_recipients: get("EMAIL_ALLOWED_RECIPIENTS")
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .collect(),
        };
        let locales: serde_json::Value =
            serde_json::from_str(include_str!("../../assets/locales.json"))
                .map_err(|_| "LOCALES_INVALID")?;
        let locale = match locales["baseLocale"].as_str() {
            Some("en") => "en",
            Some("fr") => "fr",
            _ => return Err("LOCALES_INVALID"),
        };
        smtp.validate().map_err(|_| "SMTP_CONFIGURATION_INVALID")?;
        let auth = AuthConfig::new(secret)
            .base_url(format!("{api}{}", settings::AUTH_PATH))
            .base_path(settings::AUTH_PATH)
            .trusted_origin(web.clone())
            .session_expires_in(Duration::days(7))
            .session_update_age(Duration::days(1))
            .password_min_length(settings::PASSWORD_MIN_LENGTH)
            .password_max_length(settings::PASSWORD_MAX_LENGTH);
        Ok(Self {
            database,
            bind,
            auth,
            smtp,
            web_origin: web,
            base_locale: locale,
        })
    }
}

fn required(get: &impl Fn(&str) -> Option<String>, name: &'static str) -> ConfigResult<String> {
    get(name)
        .filter(|value| !value.trim().is_empty())
        .ok_or(name)
}

fn origin(value: &str, secure: bool) -> ConfigResult<String> {
    let url = Url::parse(value).map_err(|_| "ORIGIN_INVALID")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || (secure && url.scheme() != "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("ORIGIN_INVALID");
    }
    Ok(url.origin().ascii_serialization())
}
