use std::collections::HashMap;
use webapp_api::config::runtime::{DatabaseSettings, RuntimeSettings};

fn values() -> HashMap<String, String> {
    [
        ("APP_ENV", "production"),
        (
            "DATABASE_URL",
            "postgresql://app:fixture-only@db.example.test/app?sslmode=verify-full",
        ),
        ("BETTER_AUTH_URL", "https://api.example.test"),
        ("WEB_URL", "https://app.example.test"),
        (
            "BETTER_AUTH_SECRET",
            "isolated-test-secret-not-for-production-2026",
        ),
        ("EMAIL_MODE", "smtp"),
        ("EMAIL_FROM", "auth@example.test"),
        ("SMTP_HOST", "smtp.example.test"),
        ("SMTP_PORT", "587"),
        ("SMTP_SECURE", "false"),
        ("SMTP_USER", "fixture"),
        ("SMTP_PASSWORD", "fixture-only"),
    ]
    .into_iter()
    .map(|(key, value)| (key.into(), value.into()))
    .collect()
}

#[test]
fn production_requires_verified_database_tls_and_https_origins() {
    let base = values();
    let settings = RuntimeSettings::from_values(&|key| base.get(key).cloned()).unwrap();
    assert_eq!(settings.auth.base_url, "https://api.example.test/api/auth");
    assert_eq!(
        settings.auth.trusted_origins,
        vec!["https://app.example.test"]
    );
    assert_eq!(settings.web_origin, "https://app.example.test");
    assert_eq!(settings.smtp.host, "smtp.example.test");
    for (key, value, error) in [
        (
            "DATABASE_URL",
            "postgresql://app:fixture@db.example.test/app",
            "DATABASE_TLS_VERIFY_FULL_REQUIRED",
        ),
        (
            "DATABASE_URL",
            "postgresql://app:fixture@db.example.test/app?sslmode=verify-full&sslmode=disable",
            "DATABASE_TLS_VERIFY_FULL_REQUIRED",
        ),
        ("WEB_URL", "http://app.example.test", "ORIGIN_INVALID"),
        (
            "BETTER_AUTH_URL",
            "https://api.example.test/api/auth",
            "ORIGIN_INVALID",
        ),
        (
            "BETTER_AUTH_SECRET",
            "replace-with-at-least-32-random-characters",
            "BETTER_AUTH_SECRET_INVALID",
        ),
        ("EMAIL_MODE", "capture", "SMTP_CONFIGURATION_INVALID"),
        ("SMTP_SECURE", "yes", "SMTP_SECURE_INVALID"),
    ] {
        let mut config = base.clone();
        config.insert(key.into(), value.into());
        assert_eq!(
            RuntimeSettings::from_values(&|name| config.get(name).cloned()).err(),
            Some(error),
            "{key}"
        );
    }
}

#[test]
fn database_url_cannot_override_the_verified_target_or_tls_in_query_parameters() {
    for parameter in [
        "host=remote.example.test",
        "hostaddr=192.0.2.1",
        "port=1234",
        "dbname=other",
        "user=other",
        "ssl-mode=disable",
    ] {
        let mut config = values();
        config.insert(
            "DATABASE_URL".into(),
            format!("postgres://app:fixture@db.example.test/app?sslmode=verify-full&{parameter}"),
        );
        assert_eq!(
            DatabaseSettings::from_values(&|key| config.get(key).cloned()).err(),
            Some("DATABASE_URL_PARAMETERS_INVALID")
        );
    }
}

#[test]
fn migration_authorization_binds_remote_commands_to_an_exact_target() {
    let base = values();
    let config = DatabaseSettings::from_values(&|key| base.get(key).cloned()).unwrap();
    assert!(config.authorize_migration(None, Some("enabled")).is_err());
    assert!(
        config
            .authorize_migration(Some("db.example.test:5432/other"), None)
            .is_err()
    );
    assert!(
        config
            .authorize_migration(Some("db.example.test:5432/app"), None)
            .is_ok()
    );
    let mut local = base;
    local.insert("APP_ENV".into(), "development".into());
    local.insert("POSTGRES_USER".into(), "app".into());
    local.insert("POSTGRES_PASSWORD".into(), "fixture".into());
    local.insert("POSTGRES_DB".into(), "local".into());
    local.insert("POSTGRES_PORT".into(), "5433".into());
    local.insert(
        "DATABASE_URL".into(),
        "postgres://app:fixture@localhost:5433/local".into(),
    );
    let config = DatabaseSettings::from_values(&|key| local.get(key).cloned()).unwrap();
    assert!(config.authorize_migration(None, None).is_err());
    assert!(config.authorize_migration(None, Some("enabled")).is_ok());
    local.insert("POSTGRES_DB".into(), "different".into());
    let wrong_target = DatabaseSettings::from_values(&|key| local.get(key).cloned()).unwrap();
    assert!(
        wrong_target
            .authorize_migration(None, Some("enabled"))
            .is_err()
    );
}

#[test]
fn binary_rejects_invalid_configuration_without_connecting_or_echoing_values() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_webapp-api"))
        .env_clear()
        .env("APP_ENV", "production")
        .env("DATABASE_URL", "sensitive-value-must-not-appear")
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("DATABASE_URL_INVALID"));
    assert!(!stderr.contains("sensitive-value"));
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_webapp-api"))
        .env_clear()
        .arg("--test-server")
        .output()
        .unwrap();
    assert!(!output.status.success());
}
