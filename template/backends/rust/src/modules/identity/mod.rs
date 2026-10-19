use crate::{contracts::identity::CurrentUser, infrastructure::database::schema::AppSchema};
use axum::{Json, http::StatusCode};
use better_auth::{integrations::axum::CurrentSession, prelude::AuthUser};

#[utoipa::path(get, path = "/api/me", tag = "identity", responses((status = 200, description = "Verified current user", body = CurrentUser), (status = 401, description = "No valid session"), (status = 403, description = "Unverified email")))]
pub(crate) async fn me(
    session: CurrentSession<AppSchema>,
) -> Result<Json<CurrentUser>, StatusCode> {
    if !session.user.email_verified() {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Json(CurrentUser {
        id: session.user.id().into_owned(),
        name: session
            .user
            .name()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
            .to_owned(),
        email: session
            .user
            .email()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
            .to_owned(),
        email_verified: session.user.email_verified(),
    }))
}
