use crate::{
    Application,
    config::runtime::{DatabaseSettings, RuntimeSettings},
    infrastructure::database::migrations,
};

pub async fn run() -> Result<(), &'static str> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--openapi"] {
        println!(
            "{}",
            crate::openapi::document()
                .to_pretty_json()
                .map_err(|_| "OPENAPI_FAILED")?
        );
        return Ok(());
    }
    let get = |name: &str| std::env::var(name).ok();
    if args == ["--health-check"] {
        let port: u16 = get("API_PORT")
            .unwrap_or_else(|| "3001".into())
            .parse()
            .map_err(|_| "API_PORT_INVALID")?;
        let response = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}/health/ready"))
            .timeout(std::time::Duration::from_secs(3))
            .send()
            .await
            .map_err(|_| "NOT_READY")?;
        return if response.status().is_success() {
            Ok(())
        } else {
            Err("NOT_READY")
        };
    }
    crate::infrastructure::http::logging::init_logs()?;
    if matches!(
        args.first().map(String::as_str),
        Some("--migrate" | "--check-migrations")
    ) {
        let migrate = args[0] == "--migrate";
        let target = match args.as_slice() {
            [_] => None,
            [_, flag, target] if migrate && flag == "--target" => Some(target.as_str()),
            _ => return Err("INVALID_ARGUMENTS"),
        };
        let config = DatabaseSettings::from_values(&get)?;
        if migrate {
            config.authorize_migration(target, get("DATABASE_FIXTURE_MODE").as_deref())?;
        }
        let db = config.connect().await?;
        let result = if migrate {
            migrations::apply(&db).await.map_err(|_| "MIGRATION_FAILED")
        } else {
            migrations::check(db.get_postgres_connection_pool()).await
        };
        let closed = db.close().await.map_err(|_| "DATABASE_CLOSE_FAILED");
        result.and(closed)?;
        println!("Migrations verified");
        return Ok(());
    }
    let (app, listener) = if args.is_empty() {
        let config = RuntimeSettings::from_values(&get)?;
        let listener = tokio::net::TcpListener::bind(config.bind)
            .await
            .map_err(|_| "HTTP_BIND_FAILED")?;
        (Application::from_settings(config).await?, listener)
    } else {
        fixture(&args).await?
    };
    tracing::info!(event = "api.ready", "Rust API ready");
    crate::server::serve(app, listener).await
}

#[cfg(feature = "fixtures")]
async fn fixture(args: &[String]) -> Result<(Application, tokio::net::TcpListener), &'static str> {
    if args != ["--test-server"] {
        return Err("INVALID_ARGUMENTS");
    }
    let app = crate::fixtures::test_server::create()
        .await
        .map_err(|_| "FIXTURE_STARTUP_FAILED")?;
    let listener = tokio::net::TcpListener::bind("0.0.0.0:4100")
        .await
        .map_err(|_| "HTTP_BIND_FAILED")?;
    Ok((app, listener))
}
#[cfg(not(feature = "fixtures"))]
async fn fixture(_: &[String]) -> Result<(Application, tokio::net::TcpListener), &'static str> {
    Err("INVALID_ARGUMENTS")
}
