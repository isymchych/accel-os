if [[ "$OSTYPE" == darwin* ]]; then
  export BROWSER='open'
fi



# Temporary Files
if [[ ! -d "$TMPDIR" ]]; then
  export TMPDIR="/tmp/$LOGNAME"
  mkdir -p -m 700 "$TMPDIR"
fi
TMPPREFIX="${TMPDIR%/}/zsh"



# GNU and BSD (macOS) ls flags aren't compatible
ls --version &>/dev/null
if [ $? -eq 0 ]; then
  lsflags="--color --group-directories-first -F"
else
  lsflags="-GF"
  export CLICOLOR=1
fi



export LC_ALL=en_GB.UTF-8
export LANG=en_GB.UTF-8
export LANGUAGE=en_GB.UTF-8

export EDITOR=vim
export VISUAL=vim
export PAGER=less

# TERM should be set by terminal emulator not by shell
# export TERM=xterm-256color

export LESS="-r -i -J" # smart ignore case during search, render color text

export PATH="$PATH:$HOME/bin"

# color of the suggestion color for the zsh-augosuggest
export ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=cyan"

# Source local configs
# (N) at the end of the glob suppresses the error when no matches
for file in $HOME/.zshenv_*(N); do
    source "$file"
done
