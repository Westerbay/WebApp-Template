use crate::config::runtime::DatabaseSettings;
use better_auth::seaorm::{Database, DatabaseConnection, sea_orm::ConnectOptions};
use std::time::Duration as Timeout;

impl DatabaseSettings {
    pub async fn connect(&self) -> Result<DatabaseConnection, &'static str> {
        let mut options = ConnectOptions::new(self.url.as_str());
        options
            .max_connections(10)
            .min_connections(0)
            .connect_timeout(Timeout::from_secs(5))
            .acquire_timeout(Timeout::from_secs(5))
            .sqlx_logging(false);
        Database::connect(options)
            .await
            .map_err(|_| "DATABASE_CONNECT_FAILED")
    }
}
