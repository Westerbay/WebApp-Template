//! Application-owned entities. PostgreSQL initialization uses versioned migrations.
use better_auth::AuthSchema;
use better_auth::seaorm::{
    DatabaseConnection,
    sea_orm::{ConnectionTrait, DbErr, Schema},
};

pub struct AppSchema;
impl AuthSchema for AppSchema {
    type User = user::Model;
    type Session = session::Model;
    type Account = account::Model;
    type Verification = verification::Model;
}

pub mod user {
    use better_auth::seaorm::AuthEntity;
    use better_auth::seaorm::sea_orm;
    use sea_orm::prelude::DateTimeUtc;
    use sea_orm::{
        ActiveModelBehavior, DeriveEntityModel, DerivePrimaryKey, DeriveRelation, EntityTrait,
        EnumIter, PrimaryKeyTrait,
    };

    #[derive(Clone, Debug, serde::Serialize, DeriveEntityModel, AuthEntity)]
    #[auth(role = "user")]
    #[sea_orm(table_name = "users")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub name: Option<String>,
        #[sea_orm(unique)]
        pub email: Option<String>,
        pub email_verified: bool,
        pub image: Option<String>,
        pub created_at: DateTimeUtc,
        pub updated_at: DateTimeUtc,
    }
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}
    impl ActiveModelBehavior for ActiveModel {}
}

pub mod session {
    use better_auth::seaorm::AuthEntity;
    use better_auth::seaorm::sea_orm;
    use sea_orm::prelude::DateTimeUtc;
    use sea_orm::{
        ActiveModelBehavior, DeriveEntityModel, DerivePrimaryKey, DeriveRelation, EntityTrait,
        EnumIter, PrimaryKeyTrait,
    };

    #[derive(Clone, Debug, serde::Serialize, DeriveEntityModel, AuthEntity)]
    #[auth(role = "session")]
    #[sea_orm(table_name = "sessions")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub expires_at: DateTimeUtc,
        #[sea_orm(unique)]
        pub token: String,
        pub ip_address: Option<String>,
        pub user_agent: Option<String>,
        pub user_id: String,
        pub active: bool,
        pub created_at: DateTimeUtc,
        pub updated_at: DateTimeUtc,
    }
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}
    impl ActiveModelBehavior for ActiveModel {}
}

pub mod account {
    use better_auth::seaorm::AuthEntity;
    use better_auth::seaorm::sea_orm;
    use sea_orm::prelude::DateTimeUtc;
    use sea_orm::{
        ActiveModelBehavior, DeriveEntityModel, DerivePrimaryKey, DeriveRelation, EntityTrait,
        EnumIter, PrimaryKeyTrait,
    };

    #[derive(Clone, Debug, serde::Serialize, DeriveEntityModel, AuthEntity)]
    #[auth(role = "account")]
    #[sea_orm(table_name = "accounts")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub account_id: String,
        pub provider_id: String,
        pub user_id: String,
        pub access_token: Option<String>,
        pub refresh_token: Option<String>,
        pub id_token: Option<String>,
        pub access_token_expires_at: Option<DateTimeUtc>,
        pub refresh_token_expires_at: Option<DateTimeUtc>,
        pub scope: Option<String>,
        pub password: Option<String>,
        pub created_at: DateTimeUtc,
        pub updated_at: DateTimeUtc,
    }
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}
    impl ActiveModelBehavior for ActiveModel {}
}

pub mod verification {
    use better_auth::seaorm::AuthEntity;
    use better_auth::seaorm::sea_orm;
    use sea_orm::prelude::DateTimeUtc;
    use sea_orm::{
        ActiveModelBehavior, DeriveEntityModel, DerivePrimaryKey, DeriveRelation, EntityTrait,
        EnumIter, PrimaryKeyTrait,
    };

    #[derive(Clone, Debug, serde::Serialize, DeriveEntityModel, AuthEntity)]
    #[auth(role = "verification")]
    #[sea_orm(table_name = "verifications")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        #[sea_orm(unique)]
        pub identifier: String,
        pub value: String,
        pub expires_at: DateTimeUtc,
        pub created_at: DateTimeUtc,
        pub updated_at: DateTimeUtc,
    }
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}
    impl ActiveModelBehavior for ActiveModel {}
}

pub async fn initialize_empty_database(db: &DatabaseConnection) -> Result<(), DbErr> {
    if db.get_database_backend() == better_auth::seaorm::sea_orm::DbBackend::Postgres {
        return crate::infrastructure::database::migrations::apply(db)
            .await
            .map_err(|_| DbErr::Custom("MIGRATION_FAILED".into()));
    }
    let schema = Schema::new(db.get_database_backend());
    for statement in [
        schema.create_table_from_entity(user::Entity).to_owned(),
        schema.create_table_from_entity(session::Entity).to_owned(),
        schema.create_table_from_entity(account::Entity).to_owned(),
        schema
            .create_table_from_entity(verification::Entity)
            .to_owned(),
    ] {
        db.execute(&statement).await?;
    }
    crate::infrastructure::rate_limit::store::initialize(db).await?;
    Ok(())
}
