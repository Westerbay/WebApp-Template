#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Development,
    Test,
    Staging,
    Production,
}

impl Environment {
    pub fn checks_passwords(self) -> bool {
        matches!(self, Self::Staging | Self::Production)
    }
}
