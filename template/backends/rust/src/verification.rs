//! Enforce the template's strict expiry before the pinned plugin's JWT leeway.
use crate::schema::AppSchema;
use async_trait::async_trait;
use better_auth::{
    AuthError, AuthResult,
    plugin::{AuthContext, AuthPlugin, AuthRoute},
    plugins::EmailVerificationPlugin,
    prelude::{AuthRequest, AuthResponse, HttpMethod},
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::Deserialize;
use serde_json::json;

pub struct StrictEmailVerification(pub EmailVerificationPlugin);

#[derive(Deserialize)]
struct Expiration {
    exp: i64,
}

#[async_trait]
impl AuthPlugin<AppSchema> for StrictEmailVerification {
    fn name(&self) -> &'static str {
        "template-email-verification"
    }
    fn routes(&self) -> Vec<AuthRoute> {
        <EmailVerificationPlugin as AuthPlugin<AppSchema>>::routes(&self.0)
    }
    async fn on_request(
        &self,
        req: &AuthRequest,
        ctx: &AuthContext<AppSchema>,
    ) -> AuthResult<Option<AuthResponse>> {
        if req.method == HttpMethod::Get
            && req.path == "/verify-email"
            && let Some(token) = req.query.get("token")
        {
            // Verify the signature and algorithm. Expiration itself is checked
            // below with <=, without either clock leeway or subsecond ambiguity.
            let mut validation = Validation::new(Algorithm::HS256);
            validation.validate_exp = false;
            if let Ok(decoded) = decode::<Expiration>(
                token,
                &DecodingKey::from_secret(ctx.config.secret.as_bytes()),
                &validation,
            ) && decoded.claims.exp <= chrono::Utc::now().timestamp()
            {
                if let Some(callback) = req.query.get("callbackURL") {
                    // GET callbacks are checked by the underlying endpoint,
                    // not its POST-only CSRF middleware. Preserve that check
                    // when returning early for a strictly expired token.
                    if !ctx.config.is_redirect_target_trusted(callback) {
                        return Err(AuthError::Forbidden("Invalid callbackURL".into()));
                    }
                    let (path, fragment) = callback.split_once('#').unwrap_or((callback, ""));
                    let separator = if path.contains('?') { '&' } else { '?' };
                    let mut target = format!("{path}{separator}error=token_expired");
                    if !fragment.is_empty() {
                        target.push('#');
                        target.push_str(fragment);
                    }
                    return Ok(Some(AuthResponse::new(302).with_header("Location", target)));
                }
                return Ok(Some(AuthResponse::json(
                    400,
                    &json!({"message":"token_expired"}),
                )?));
            }
        }
        self.0.on_request(req, ctx).await
    }
}
