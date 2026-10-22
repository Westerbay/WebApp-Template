pub fn init_logs() -> Result<(), &'static str> {
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
