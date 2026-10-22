//! Better Auth RS does not send an email after email/password signup at this revision.
//! Compose its public plugins to preserve the template's automatic verification email.
use super::password::ExactPasswordHasher;
use crate::infrastructure::database::schema::AppSchema;
use async_trait::async_trait;
use better_auth::{
    AuthError, AuthResult,
    plugin::{AuthContext, AuthPlugin, AuthRoute},
    plugins::{EmailPasswordPlugin, EmailVerificationPlugin},
    prelude::{AuthAccount, AuthRequest, AuthResponse, AuthUser, HttpMethod},
    seaorm::{SeaOrmUserModel, sea_orm::TryIntoModel},
};
use better_auth_core::{CreateUser, PasswordHasher, wire::UserView};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

pub struct SignupWithVerification {
    pub password: EmailPasswordPlugin,
    pub verification: EmailVerificationPlugin,
    pub hasher: Arc<ExactPasswordHasher>,
}

#[derive(Deserialize)]
struct SignupEmail {
    name: String,
    email: String,
    password: String,
    #[serde(rename = "callbackURL")]
    callback_url: Option<String>,
}

#[derive(Deserialize)]
struct SigninCredentials {
    email: String,
    password: String,
}

#[async_trait]
impl AuthPlugin<AppSchema> for SignupWithVerification {
    fn name(&self) -> &'static str {
        "template-email-password"
    }
    fn routes(&self) -> Vec<AuthRoute> {
        <EmailPasswordPlugin as AuthPlugin<AppSchema>>::routes(&self.password)
    }
    async fn on_init(
        &self,
        ctx: &mut better_auth::plugin::AuthInitContext<AppSchema>,
    ) -> AuthResult<()> {
        self.password.on_init(ctx).await
    }
    async fn on_request(
        &self,
        req: &AuthRequest,
        ctx: &AuthContext<AppSchema>,
    ) -> AuthResult<Option<AuthResponse>> {
        // The pinned upstream email sign-in ignores require_email_verification.
        // Reject an unverified account only after checking its password, before
        // the upstream plugin has any opportunity to create a session.
        if req.method == HttpMethod::Post && req.path == "/sign-in/email" {
            let Ok(credentials) = req.body_as_json::<SigninCredentials>() else {
                return self.password.on_request(req, ctx).await;
            };
            if credentials.password.is_empty() {
                return self.password.on_request(req, ctx).await;
            }
            if let Some(user) = ctx.database.get_user_by_email(&credentials.email).await?
                && !user.email_verified()
            {
                let accounts = ctx.database.get_user_accounts(&user.id()).await?;
                let hash = accounts
                    .iter()
                    .find(|account| account.provider_id() == "credential")
                    .and_then(AuthAccount::password)
                    .ok_or(AuthError::InvalidCredentials)?;
                if !ExactPasswordHasher::default()
                    .verify(hash, &credentials.password)
                    .await?
                {
                    return Err(AuthError::InvalidCredentials);
                }
                return Err(AuthError::Upstream {
                    status: 403,
                    code: "EMAIL_NOT_VERIFIED",
                    message: "Email not verified",
                });
            }
        }
        let response = match self.password.on_request(req, ctx).await {
            Ok(response) => response,
            Err(error) if req.method == HttpMethod::Post && req.path == "/sign-up/email" => {
                // This pinned revision distinguishes a pre-existing email from a
                // uniqueness race. Both have already passed upstream validation;
                // only the first still needs the configured HIBP/hash work.
                let hash_needed = match &error {
                    AuthError::UnprocessableEntity(message)
                        if message == "User already exists. Use another email." =>
                    {
                        true
                    }
                    AuthError::UnprocessableEntity(message)
                        if message == "Failed to create user" =>
                    {
                        false
                    }
                    _ => return Err(error),
                };
                let signup: SignupEmail = req.body_as_json()?;
                if ctx
                    .database
                    .get_user_by_email(&signup.email)
                    .await?
                    .is_none()
                {
                    return Err(error);
                }
                if hash_needed {
                    self.hasher.hash(&signup.password).await?;
                }
                // Reuse the actual entity factory and wire projection so random
                // IDs, timestamps and optional fields match a new signup. Never
                // use the stored user's profile or issue mail/session cookies.
                let user = <crate::infrastructure::database::schema::user::Model as SeaOrmUserModel>::new_active(
                    None,
                    CreateUser::new()
                        .with_name(signup.name)
                        .with_email(signup.email.to_lowercase()),
                    Utc::now(),
                )
                .try_into_model()
                .map_err(|_| AuthError::internal("Synthetic signup failed"))?;
                return Ok(Some(AuthResponse::json(
                    200,
                    &json!({"token":null,"user":UserView::from(&user)}),
                )?));
            }
            Err(error) => return Err(error),
        };
        let signed_up = req.method == HttpMethod::Post
            && req.path == "/sign-up/email"
            && response
                .as_ref()
                .is_some_and(|response| response.status == 200);
        if signed_up {
            let signup: SignupEmail = req.body_as_json()?;
            let mut verification = req.clone();
            verification.headers.remove("cookie");
            verification.path = "/send-verification-email".into();
            verification.body = Some(serde_json::to_vec(
                &json!({"email":signup.email,"callbackURL":signup.callback_url}),
            )?);
            self.verification.on_request(&verification, ctx).await?;
        }
        Ok(response)
    }
}
