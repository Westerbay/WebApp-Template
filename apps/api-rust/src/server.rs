use crate::{Application, config::runtime::RuntimeSettings};

pub(crate) async fn run(get: &impl Fn(&str) -> Option<String>) -> Result<(), &'static str> {
    let config = RuntimeSettings::from_values(get)?;
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|_| "HTTP_BIND_FAILED")?;
    let app = Application::from_settings(config).await?;
    tracing::info!(event = "api.ready", "Rust API ready");
    serve(app, listener).await
}

pub(crate) async fn run_fixture() -> Result<(), &'static str> {
    let (app, listener) = fixture().await?;
    tracing::info!(event = "api.ready", "Rust API ready");
    serve(app, listener).await
}

pub async fn serve(
    app: Application,
    listener: tokio::net::TcpListener,
) -> Result<(), &'static str> {
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

#[cfg(feature = "fixtures")]
async fn fixture() -> Result<(Application, tokio::net::TcpListener), &'static str> {
    let app = crate::fixtures::test_server::create()
        .await
        .map_err(|_| "FIXTURE_STARTUP_FAILED")?;
    let listener = tokio::net::TcpListener::bind("0.0.0.0:4100")
        .await
        .map_err(|_| "HTTP_BIND_FAILED")?;
    Ok((app, listener))
}
#[cfg(not(feature = "fixtures"))]
async fn fixture() -> Result<(Application, tokio::net::TcpListener), &'static str> {
    Err("INVALID_ARGUMENTS")
}
