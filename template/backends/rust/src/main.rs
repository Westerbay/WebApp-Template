use webapp_api::{
    Application,
    runtime::{DatabaseSettings, RuntimeSettings},
};

#[tokio::main]
async fn main() -> std::process::ExitCode {
    match run().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("Rust API failed: {code}");
            std::process::ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), &'static str> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--openapi"] {
        println!(
            "{}",
            webapp_api::openapi::document()
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
    init_logs()?;
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
            webapp_api::migrations::apply(&db)
                .await
                .map_err(|_| "MIGRATION_FAILED")
        } else {
            webapp_api::migrations::check(db.get_postgres_connection_pool()).await
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
        (config.application().await?, listener)
    } else {
        fixture(&args).await?
    };
    tracing::info!(event = "api.ready", "Rust API ready");
    serve(app, listener).await
}

#[cfg(feature = "fixtures")]
async fn fixture(args: &[String]) -> Result<(Application, tokio::net::TcpListener), &'static str> {
    if args != ["--test-server"] {
        return Err("INVALID_ARGUMENTS");
    }
    let app = webapp_api::test_server::create()
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

fn init_logs() -> Result<(), &'static str> {
    use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .json()
                .with_writer(std::io::stderr)
                // Upstream debug/error logs can contain personal data or tokens.
                .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
                    metadata.target().starts_with("webapp_api")
                })),
        )
        .try_init()
        .map_err(|_| "LOG_INIT_FAILED")
}

async fn serve(app: Application, listener: tokio::net::TcpListener) -> Result<(), &'static str> {
    let served = axum::serve(
        listener,
        app.router
            .into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await
    .map_err(|_| "HTTP_SERVE_FAILED");
    let drained = app.mailbox.drain().await;
    let closed = app
        .database
        .close()
        .await
        .map_err(|_| "DATABASE_CLOSE_FAILED");
    if served.is_err() {
        tracing::error!(event = "http.shutdown.failed");
    }
    if drained.is_err() {
        tracing::error!(event = "email.shutdown.failed");
    }
    if closed.is_err() {
        tracing::error!(event = "database.shutdown.failed");
    }
    served.and(drained).and(closed)
}

async fn shutdown() {
    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut term) => {
                tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
            }
            Err(_) => tracing::error!(event = "api.shutdown_signal.failed"),
        }
    }
    #[cfg(not(unix))]
    if tokio::signal::ctrl_c().await.is_err() {
        tracing::error!(event = "api.shutdown_signal.failed");
    }
}
