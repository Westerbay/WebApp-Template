use crate::{
    Application,
    config::runtime::RuntimeSettings,
    infrastructure::{auth::AuthServices, database::migrations, email::mail::Mailbox},
};

impl Application {
    pub async fn from_settings(config: RuntimeSettings) -> Result<Application, &'static str> {
        let mailbox = Mailbox::new(&config.web_origin, config.base_locale, config.smtp)
            .map_err(|_| "SMTP_CONFIGURATION_INVALID")?;
        let services = AuthServices::configured(mailbox).map_err(|_| "AUTH_SERVICES_INVALID")?;
        let database = config.database.connect().await?;
        if let Err(error) = migrations::check(database.get_postgres_connection_pool()).await {
            if database.close().await.is_err() {
                tracing::error!(event = "database.cleanup.failed");
            }
            return Err(error);
        }
        let result = Application::connect(config.auth, database.clone(), services).await;
        match result {
            Ok(app) => Ok(app),
            Err(_) => {
                if database.close().await.is_err() {
                    tracing::error!(event = "database.cleanup.failed");
                }
                Err("AUTH_STARTUP_FAILED")
            }
        }
    }
}
