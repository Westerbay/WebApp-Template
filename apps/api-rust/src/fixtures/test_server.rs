//! Owned Docker fixture entry point; the production configuration path serves HTTP.
use crate::{Application, config::runtime::RuntimeSettings, infrastructure::database::schema};
use better_auth::seaorm::{
    Database,
    sea_orm::{ConnectOptions, ConnectionTrait},
};
use url::Url;

pub async fn create() -> Result<Application, Box<dyn std::error::Error>> {
    let web_origin = loopback_origin("RUST_AUTH_TEST_WEB_ORIGIN")?;
    let api_origin = loopback_origin("RUST_AUTH_TEST_API_ORIGIN")?;
    let database_url = "postgres://prototype:prototype@postgres:5432/rust_auth_prototype";
    let namespace = format!("frontend_{:x}", rand::random::<u64>());
    let admin = Database::connect(database_url).await?;
    admin
        .execute_unprepared(&format!("CREATE SCHEMA {namespace}"))
        .await?;
    admin.close().await?;
    let mut options = ConnectOptions::new(database_url);
    options
        .set_schema_search_path(namespace.clone())
        .sqlx_logging(false);
    let database = Database::connect(options).await?;
    schema::initialize_empty_database(&database).await?;
    database.close().await?;
    let mut url = Url::parse(database_url)?;
    url.query_pairs_mut()
        .append_pair("options", &format!("-csearch_path={namespace}"));
    let config = RuntimeSettings::from_values(&|name| {
        let value = match name {
            "APP_ENV" => "test",
            "DATABASE_URL" => url.as_str(),
            "BETTER_AUTH_URL" => &api_origin,
            "WEB_URL" => &web_origin,
            "BETTER_AUTH_SECRET" => "isolated-test-secret-not-for-production-2026",
            "EMAIL_MODE" => "capture",
            "EMAIL_FROM" => "no-reply@example.test",
            "SMTP_HOST" => "mailpit",
            "SMTP_PORT" => "1025",
            "SMTP_SECURE" => "false",
            _ => return None,
        };
        Some(value.into())
    })?;
    Ok(Application::from_settings(config).await?)
}

fn loopback_origin(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    let value = std::env::var(name)?;
    let url = Url::parse(&value)?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Only loopback test origins are allowed".into());
    }
    Ok(url.origin().ascii_serialization())
}
