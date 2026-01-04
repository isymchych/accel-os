set nocompatible              " be iMproved, required
filetype off                  " required

" set the runtime path to include Vundle and initialize
set rtp+=~/.vim/bundle/Vundle.vim
call vundle#begin()

" let Vundle manage Vundle, required
Plugin 'gmarik/Vundle.vim'

Plugin 'tpope/vim-sensible'
Plugin 'tpope/vim-surround'
Plugin 'tpope/vim-fugitive'

Plugin 'scrooloose/nerdcommenter'
Plugin 'scrooloose/nerdtree'

Plugin 'tommcdo/vim-exchange'
Plugin 'kien/ctrlp.vim'
Plugin 'editorconfig/editorconfig-vim'
Plugin 'Raimondi/delimitMate'
Plugin 'ervandew/supertab'

Plugin 'pangloss/vim-javascript'
Plugin 'mxw/vim-jsx'

Plugin 'vim-airline/vim-airline'
Plugin 'vim-airline/vim-airline-themes'
Plugin 'overcache/NeoSolarized'
Plugin 'airblade/vim-gitgutter'

call vundle#end()
filetype plugin indent on


" check OS
if !exists("g:os")
    if has("win64") || has("win32") || has("win16")
        let g:os = "Windows"
    else
        let g:os = substitute(system('uname'), '\n', '', '')
    endif
endif


" no sounds
set noerrorbells visualbell t_vb=
autocmd GUIEnter * set visualbell t_vb=

set guioptions-=T " hide toolbar
set guioptions-=m " hide menu
set guioptions-=L  "remove left-hand scroll bar


set fileencodings=utf8,cp1251,koi8-r
set termencoding=utf-8
set encoding=utf-8

"  store temporary files in a central spot
set backupdir=~/.vim/tmp,/var/tmp,/tmp
set directory=~/.vim/tmp,/var/tmp,/tmp

" jump to the last position when reopening a file
if has("autocmd")
    au BufReadPost * if line("'\"") > 1 && line("'\"") <= line("$") | exe "normal! g'\"" | endif
endif


let mapleader = " "
set notimeout


syntax on " fite-type highlighting and configuration
set cursorline " underscore cursor line
" set number " show line numbers
set history=50 " keep 50 lines of command line history
set hlsearch " highlight search terms

" /-style searches now are case-sensitive only if there is a capital letter in the
" search expression
set ignorecase
set smartcase
set shortmess=atI " shorten text in "Press ENTER to continue... etc.

set tabstop=4 softtabstop=4 shiftwidth=4
set expandtab

set wildmode=longest:full " show completions for ex commands

" use system clipboard (requires gvim)
if g:os == "Linux"
    set clipboard=unnamedplus
elseif g:os == "Darwin"
    set clipboard=unnamed
endif

" allow to use mouse
set mouse=a

let g:netrw_liststyle=3 " show file tree in NetRW (Explore)

" enable 24bit TrueColor support
set termguicolors



" ---------------------------------------- PLUGINS CONFIG



" ignore error about missing theme during initial run
silent! colorscheme NeoSolarized



" Airline
set noshowmode
set timeoutlen=50
let g:airline_left_sep=''
let g:airline_right_sep=''
" let g:airline_section_z (column number, line number, percentage)
let g:airline_section_z='%4l%3v%3p%%'
let g:airline#extensions#hunks#enabled = 0



" CtrlP
let g:ctrlp_match_window = 'bottom,order:ttb'
let g:ctrlp_switch_buffer = 0
let g:ctrlp_working_path_mode = 0
let g:ctrlp_user_command = 'ag %s -l --nocolor --hidden -g ""'



" Vim-jsx
let g:jsx_ext_required = 0

" ---------------------------------------- KEYBINDINGS
nnoremap <F12> :if &go=~#'m'<Bar>set go-=m<Bar>else<Bar>set go+=m<Bar>endif<CR>

nnoremap <Leader>o :CtrlP<CR>
nnoremap <Leader>b :CtrlPBuffer<CR>
nnoremap <Leader>d :NERDTreeToggle<CR>

nnoremap <Leader>w :w<CR>
nnoremap <Leader>q :q<CR>
nnoremap <Leader>rtw :%s/\s\+$//e<CR> " remove trailing whitespace

nnoremap <Leader>gt :!tig<CR>
nnoremap <Leader>gs :Gstatus<CR>
