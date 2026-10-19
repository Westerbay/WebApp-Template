//! Shared admission and increment happen under the same database row lock.
use async_trait::async_trait;
use better_auth::seaorm::{
    DatabaseConnection,
    sea_orm::{ConnectionTrait, DbErr, Statement},
};
use better_auth::{
    AuthResult,
    middleware::Middleware,
    prelude::{AuthRequest, AuthResponse},
};
use chrono::Utc;
use serde_json::json;

#[derive(Clone)]
pub struct SharedQuotas(pub DatabaseConnection);

impl SharedQuotas {
    pub async fn consume(
        &self,
        key: &str,
        max: i32,
        window_seconds: i64,
    ) -> Result<Option<i64>, DbErr> {
        let now = Utc::now().timestamp_millis();
        let cutoff = now - window_seconds * 1000;
        let backend = self.0.get_database_backend();
        self.0
            .execute_raw(Statement::from_sql_and_values(
                backend,
                "DELETE FROM auth_rate_limits WHERE last_request < $1",
                [cutoff.into()],
            ))
            .await?;
        let admitted = self.0.query_one_raw(Statement::from_sql_and_values(backend,
            "INSERT INTO auth_rate_limits (key, count, last_request) VALUES ($1, 1, $2)
             ON CONFLICT (key) DO UPDATE SET
               count = CASE WHEN auth_rate_limits.last_request <= $3 THEN 1 ELSE auth_rate_limits.count + 1 END,
               last_request = $2
             WHERE auth_rate_limits.last_request <= $3 OR auth_rate_limits.count < $4
             RETURNING count", [key.into(), now.into(), cutoff.into(), max.into()])).await?;
        if admitted.is_some() {
            return Ok(None);
        }
        let row = self
            .0
            .query_one_raw(Statement::from_sql_and_values(
                backend,
                "SELECT last_request FROM auth_rate_limits WHERE key = $1",
                [key.into()],
            ))
            .await?;
        let last = row
            .map(|row| row.try_get::<i64>("", "last_request"))
            .transpose()?
            .unwrap_or(now);
        Ok(Some(
            ((last + window_seconds * 1000 - now + 999) / 1000).max(1),
        ))
    }
}

#[async_trait]
impl Middleware for SharedQuotas {
    fn name(&self) -> &'static str {
        "template-shared-auth-quotas"
    }
    async fn before_request(&self, req: &AuthRequest) -> AuthResult<Option<AuthResponse>> {
        let path = req
            .path
            .strip_prefix(crate::settings::AUTH_PATH)
            .unwrap_or(&req.path);
        let path = if path.starts_with("/reset-password/") {
            "/reset-password/:token"
        } else {
            path
        };
        let max = if matches!(
            path,
            "/sign-in/email"
                | "/sign-up/email"
                | "/send-verification-email"
                | "/request-password-reset"
                | "/reset-password"
        ) {
            5
        } else {
            100
        };
        let peer = req
            .headers
            .get("x-forwarded-for")
            .map(String::as_str)
            .unwrap_or("unknown");
        let key = format!("{peer}:{path}");
        match self.consume(&key, max, 60).await {
            Ok(None) => Ok(None),
            Ok(Some(seconds)) => Ok(Some(
                AuthResponse::json(
                    429,
                    &json!({"code":"TOO_MANY_REQUESTS", "message":"Too many requests"}),
                )?
                .with_header("Retry-After", seconds.to_string())
                .with_header("X-Retry-After", seconds.to_string()),
            )),
            Err(_) => {
                tracing::error!(
                    event = "auth.quota.failed",
                    "Shared quota storage unavailable"
                );
                Ok(Some(AuthResponse::json(
                    503,
                    &json!({"code":"SERVICE_UNAVAILABLE", "message":"Rate limit service unavailable"}),
                )?))
            }
        }
    }
}

pub async fn initialize(db: &DatabaseConnection) -> Result<(), DbErr> {
    db.execute_unprepared("CREATE TABLE auth_rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, last_request BIGINT NOT NULL)").await?;
    db.execute_unprepared(
        "CREATE INDEX auth_rate_limits_last_request_idx ON auth_rate_limits (last_request)",
    )
    .await?;
    Ok(())
}
