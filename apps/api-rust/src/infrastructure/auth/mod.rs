pub mod hibp;
mod password;
mod signup;
mod verification;

use crate::{
    config::auth as settings,
    infrastructure::{
        database::schema::AppSchema, email::mail::Mailbox, rate_limit::store as quotas,
    },
};
use better_auth::{
    AuthConfig, BetterAuth,
    middleware::RateLimitConfig,
    plugins::{
        EmailPasswordPlugin, EmailVerificationPlugin, PasswordManagementPlugin,
        SessionManagementPlugin,
    },
    seaorm::{DatabaseConnection, SeaOrmStore},
};
use password::ExactPasswordHasher;
use signup::SignupWithVerification;
use std::sync::Arc;

pub(crate) type AuthState = Arc<BetterAuth<AppSchema>>;

pub struct AuthServices {
    pub mailbox: Mailbox,
    pub password_check: hibp::PasswordCheck,
}

impl AuthServices {
    pub fn configured(mailbox: Mailbox) -> better_auth::AuthResult<Self> {
        let password_check = if mailbox.environment().checks_passwords() {
            hibp::PasswordCheck::enabled()?
        } else {
            hibp::PasswordCheck::Offline
        };
        Ok(Self {
            mailbox,
            password_check,
        })
    }
}

pub(crate) async fn create(
    config: AuthConfig,
    database: DatabaseConnection,
    services: AuthServices,
) -> better_auth::AuthResult<Arc<BetterAuth<AppSchema>>> {
    let mailbox = services.mailbox;
    let hasher = Arc::new(ExactPasswordHasher {
        check: services.password_check,
    });
    let verification = || {
        EmailVerificationPlugin::new()
            .verification_token_expiry(chrono::Duration::hours(settings::VERIFICATION_HOURS))
            .auto_sign_in_after_verification(false)
            .custom_send_verification_email(Arc::new(mailbox.clone()))
    };
    let store = SeaOrmStore::<AppSchema>::new(config.clone(), database.clone());
    let auth = Arc::new(
        BetterAuth::<AppSchema>::new(config)
            .store(store)
            .rate_limit(RateLimitConfig::new().enabled(false))
            .middleware(quotas::SharedQuotas(database.clone()))
            .plugin(SignupWithVerification {
                password: EmailPasswordPlugin::new()
                    .require_email_verification(true)
                    .auto_sign_in(false)
                    .password_min_length(settings::PASSWORD_MIN_LENGTH)
                    .password_max_length(settings::PASSWORD_MAX_LENGTH)
                    .password_hasher(hasher.clone()),
                verification: verification(),
                hasher: hasher.clone(),
            })
            .plugin(verification::StrictEmailVerification(verification()))
            .plugin(
                PasswordManagementPlugin::new()
                    .reset_token_expiry_hours(settings::RESET_HOURS)
                    .revoke_sessions_on_password_reset(true)
                    .password_hasher(hasher)
                    .send_reset_password(Arc::new(mailbox.clone())),
            )
            .plugin(SessionManagementPlugin::new())
            .build()
            .await?,
    );
    Ok(auth)
}
