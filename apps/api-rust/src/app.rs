use crate::{
    config::auth as settings,
    infrastructure::{
        auth::{self, AuthServices},
        database::schema::{self, AppSchema},
        email::mail::Mailbox,
        http,
    },
    modules::{health, identity, users},
    openapi,
};
use axum::Router;
use better_auth::{
    AuthConfig, BetterAuth,
    integrations::axum::AxumIntegration,
    seaorm::{Database, DatabaseConnection},
};
use std::sync::Arc;

pub struct Application {
    pub router: Router,
    pub auth: Arc<BetterAuth<AppSchema>>,
    pub mailbox: Mailbox,
    pub database: DatabaseConnection,
}

impl Application {
    pub async fn local() -> Result<Self, Box<dyn std::error::Error>> {
        Self::with_config(settings::local()).await
    }

    /// The prototype can only initialize a new, private in-memory database.
    pub async fn with_config(config: AuthConfig) -> Result<Self, Box<dyn std::error::Error>> {
        let database = Database::connect("sqlite::memory:").await?;
        Self::with_database(config, database).await
    }

    /// The caller must supply an empty disposable database (used by PostgreSQL tests).
    pub async fn with_database(
        config: AuthConfig,
        database: DatabaseConnection,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        schema::initialize_empty_database(&database).await?;
        Self::connect(
            config,
            database,
            AuthServices::configured(Mailbox::default())?,
        )
        .await
    }

    /// Attach another API replica to an already initialized application database.
    pub async fn connect(
        config: AuthConfig,
        database: DatabaseConnection,
        services: AuthServices,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let mailbox = services.mailbox.clone();
        let web_origin = config
            .trusted_origins
            .first()
            .ok_or("Missing web origin")?
            .clone();
        let auth = auth::create(config, database.clone(), services).await?;
        let router = Router::new()
            .merge(health::router(database.clone()))
            .merge(identity::router(database.clone()))
            .merge(users::router(database.clone()))
            .merge(openapi::router())
            .nest(settings::AUTH_PATH, auth.clone().axum_router())
            .with_state(auth.clone());
        let router = http::configure(router, &web_origin)?;
        Ok(Self {
            router,
            auth,
            mailbox,
            database,
        })
    }
}
