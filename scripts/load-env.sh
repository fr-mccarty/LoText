# Sourced, not run: reads `.env` at the top of the project, if there is one, into the environment.
# A variable already set in the environment wins over the file. `.env` is gitignored and holds
# what is particular to this Mac — addresses, logins; `.env.example` shows what it may set.

_lotext_env="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"
if [ -f "$_lotext_env" ]; then
  while IFS='=' read -r _key _value; do
    case "$_key" in ''|\#*) continue ;; esac
    _value=${_value%\"}; _value=${_value#\"}
    [ -n "${!_key:-}" ] || export "$_key=$_value"
  done < "$_lotext_env"
fi
unset _lotext_env _key _value
