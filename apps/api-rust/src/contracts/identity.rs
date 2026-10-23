use serde::Serialize;

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurrentUser {
    pub(crate) id: String,
    pub(crate) name: String,
    #[schema(format = Email)]
    pub(crate) email: String,
    pub(crate) email_verified: bool,
}
