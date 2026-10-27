#[derive(Debug, PartialEq, Eq)]
pub(super) enum Command {
    OpenApi,
    HealthCheck,
    Migrate { target: Option<String> },
    CheckMigrations,
    Serve,
    TestServer,
}

impl Command {
    pub(super) fn parse(args: &[String]) -> Result<Self, &'static str> {
        match args
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .as_slice()
        {
            [] => Ok(Self::Serve),
            ["--openapi"] => Ok(Self::OpenApi),
            ["--health-check"] => Ok(Self::HealthCheck),
            ["--migrate"] => Ok(Self::Migrate { target: None }),
            ["--migrate", "--target", target] => Ok(Self::Migrate {
                target: Some((*target).to_owned()),
            }),
            ["--check-migrations"] => Ok(Self::CheckMigrations),
            ["--test-server"] => Ok(Self::TestServer),
            _ => Err("INVALID_ARGUMENTS"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Command;

    #[test]
    fn parses_each_command_without_reading_runtime_configuration() {
        for (args, expected) in [
            (vec![], Command::Serve),
            (vec!["--openapi"], Command::OpenApi),
            (vec!["--health-check"], Command::HealthCheck),
            (vec!["--migrate"], Command::Migrate { target: None }),
            (
                vec!["--migrate", "--target", "db.example.test:5432/app"],
                Command::Migrate {
                    target: Some("db.example.test:5432/app".into()),
                },
            ),
            (vec!["--check-migrations"], Command::CheckMigrations),
            (vec!["--test-server"], Command::TestServer),
        ] {
            let args: Vec<String> = args.into_iter().map(String::from).collect();
            assert_eq!(Command::parse(&args), Ok(expected));
        }
    }

    #[test]
    fn rejects_ambiguous_commands_and_misplaced_migration_targets() {
        for args in [
            vec!["--openapi", "--health-check"],
            vec!["--check-migrations", "--target", "db:5432/app"],
            vec!["--migrate", "--target"],
            vec!["--migrate", "--target", "db:5432/app", "extra"],
            vec!["--test-server", "extra"],
            vec!["unknown"],
        ] {
            let args: Vec<String> = args.into_iter().map(String::from).collect();
            assert_eq!(Command::parse(&args), Err("INVALID_ARGUMENTS"));
        }
    }
}
