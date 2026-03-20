vim.g.mapleader = " "
vim.g.maplocalleader = " "

vim.g.have_nerd_font = true

vim.opt.number = false
vim.opt.mouse = "a"
-- Needed by some UI plugins/features that react to pointer movement.
vim.opt.mousemoveevent = true -- Allow hovering in bufferline
vim.opt.showmode = false
-- Prefer system clipboard by default since this config is mainly for ad-hoc editing.
vim.opt.clipboard = "unnamedplus"
vim.opt.breakindent = true
vim.opt.undofile = true
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.signcolumn = "yes"
vim.opt.updatetime = 250
vim.opt.timeoutlen = 300
vim.opt.splitright = true
vim.opt.splitbelow = true
vim.opt.list = true
vim.opt.listchars = { tab = "▸  ", trail = "·", nbsp = "␣" }
vim.opt.inccommand = "split"
vim.opt.cursorline = true
vim.opt.scrolloff = 5

vim.opt.hlsearch = true
vim.keymap.set("n", "<Esc>", "<cmd>nohlsearch<CR>")
-- Easier terminal escape than <C-\><C-n>.
vim.keymap.set("t", "<Esc><Esc>", "<C-\\><C-n>", { desc = "Exit terminal mode" })
-- Keep split navigation on familiar Ctrl-hjkl.
vim.keymap.set("n", "<C-h>", "<C-w><C-h>", { desc = "Move focus to the left window" })
vim.keymap.set("n", "<C-l>", "<C-w><C-l>", { desc = "Move focus to the right window" })
vim.keymap.set("n", "<C-j>", "<C-w><C-j>", { desc = "Move focus to the lower window" })
vim.keymap.set("n", "<C-k>", "<C-w><C-k>", { desc = "Move focus to the upper window" })

vim.api.nvim_create_autocmd("TextYankPost", {
	desc = "Highlight when yanking text",
	group = vim.api.nvim_create_augroup("highlight-yank", { clear = true }),
	callback = function()
		vim.highlight.on_yank()
	end,
})

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
	-- Bootstrap the plugin manager on first launch.
	local lazyrepo = "https://github.com/folke/lazy.nvim.git"
	vim.fn.system({ "git", "clone", "--filter=blob:none", "--branch=stable", lazyrepo, lazypath })
end ---@diagnostic disable-next-line: undefined-field
vim.opt.rtp:prepend(lazypath)

local function project_root()
	return vim.fs.root(0, { ".git", ".hg", ".svn" })
		or vim.fn.getcwd()
end

local function open_floating_terminal(cmd, opts)
	opts = opts or {}

	local width = math.floor(vim.o.columns * 0.9)
	local height = math.floor(vim.o.lines * 0.9)
	local row = math.floor((vim.o.lines - height) / 2)
	local col = math.floor((vim.o.columns - width) / 2)

	local buf = vim.api.nvim_create_buf(false, true)
	vim.bo[buf].bufhidden = "wipe"

	local win = vim.api.nvim_open_win(buf, true, {
		relative = "editor",
		row = row,
		col = col,
		width = width,
		height = height,
		style = "minimal",
		border = "rounded",
	})

	vim.fn.termopen(cmd, {
		cwd = opts.cwd,
		on_exit = function()
			vim.schedule(function()
				if vim.api.nvim_win_is_valid(win) then
					vim.api.nvim_win_close(win, true)
				end
			end)
		end,
	})

	vim.keymap.set("t", "<Esc><Esc>", function()
		if vim.api.nvim_win_is_valid(win) then
			vim.api.nvim_win_close(win, true)
		end
	end, { buffer = buf, silent = true, desc = "Close floating terminal" })

	vim.cmd.startinsert()
end

local function open_lazygit()
	if vim.fn.executable("lazygit") ~= 1 then
		vim.notify("lazygit not found in PATH", vim.log.levels.ERROR)
		return
	end

	open_floating_terminal({ "lazygit" }, { cwd = project_root() })
end

require("lazy").setup({
	"tpope/vim-sleuth", -- Detect tabstop and shiftwidth automatically

	{ "numToStr/Comment.nvim", opts = {} },

	{
		"mikavilpas/yazi.nvim",
		event = "VeryLazy",
		dependencies = {
			"nvim-lua/plenary.nvim",
		},
		-- Use yazi as the main filesystem navigator and hand directory editing off to it.
		init = function()
			vim.g.loaded_netrwPlugin = 1
		end,
		keys = {
			{ "<leader>d", "<cmd>Yazi<cr>", desc = "Open [D]irectory navigator" },
			{ "<leader>D", "<cmd>Yazi cwd<cr>", desc = "Open [D]irectory navigator in cwd" },
			{ "<leader>Pd", function() require("yazi").yazi(nil, project_root()) end, desc = "Open [P]roject [D]irectory navigator" },
			{ "<C-Up>", "<cmd>Yazi toggle<cr>", desc = "Resume yazi" },
		},
		opts = {
			open_for_directories = true,
			keymaps = {
				show_help = "<f1>",
			},
		},
	},

	{
		"lewis6991/gitsigns.nvim",
		opts = {
			signs = {
				add = { text = "+" },
				change = { text = "~" },
				delete = { text = "_" },
				topdelete = { text = "‾" },
				changedelete = { text = "~" },
			},
			on_attach = function(bufnr)
				local gs = package.loaded.gitsigns
				local function map(mode, l, r, opts)
					opts = opts or {}
					opts.buffer = bufnr
					vim.keymap.set(mode, l, r, opts)
				end
				map({ "n", "v" }, "]c", gs.next_hunk, { desc = "Jump to next git [c]hange" })
				map({ "n", "v" }, "[c", gs.prev_hunk, { desc = "Jump to previous git [c]hange" })
				map("n", "<leader>hs", gs.stage_hunk, { desc = "git [s]tage hunk" })
				map("n", "<leader>gr", gs.reset_hunk, { desc = "git [r]eset hunk" })
				map("n", "<leader>hu", gs.undo_stage_hunk, { desc = "git [u]ndo stage hunk" })
				map("n", "<leader>hp", gs.preview_hunk, { desc = "git [p]review hunk" })
				map("n", "<leader>gb", gs.blame_line, { desc = "git [b]lame line" })
				map("n", "<leader>hd", gs.diffthis, { desc = "git [d]iff against index" })
				map("v", "<leader>hs", function()
					gs.stage_hunk({ vim.fn.line("."), vim.fn.line("v") })
				end, { desc = "stage git hunk" })
				map("v", "<leader>hr", function()
					gs.reset_hunk({ vim.fn.line("."), vim.fn.line("v") })
				end, { desc = "reset git hunk" })
			end,
		},
	},

	{ -- Useful plugin to show you pending keybinds.
		"folke/which-key.nvim",
		event = "VimEnter",
		config = function()
			local wk = require("which-key")
			wk.setup()

			wk.add({
				{ "<leader>f", group = "[F]ind" },
				{ "<leader>D", group = "[D]ir" },
				{ "<leader>P", group = "[P]roject" },
				{ "<leader>g", group = "[G]it" },
				{ "<leader>h", group = "Git [H]unk" },
			})
			wk.add({
				{ "<leader>h", group = "Git [H]unk", mode = "v" },
			})
		end,
	},

	{
		"nvim-telescope/telescope.nvim",
		event = "VimEnter",
		dependencies = {
			"nvim-lua/plenary.nvim",
			{ "nvim-tree/nvim-web-devicons", enabled = vim.g.have_nerd_font },
		},
		config = function()
			-- Keep fuzzy navigation/discovery; this is the main "quality of life" upgrade over plain Vim.
			require("telescope").setup({})

			local builtin = require("telescope.builtin")
			vim.keymap.set("n", "<leader>b", builtin.buffers, { desc = "[B]uffers" })
			vim.keymap.set("n", "<leader>r", builtin.oldfiles, { desc = "[R]ecent files" })
			vim.keymap.set("n", "<leader>y", builtin.registers, { desc = "[Y]ank/registers" })

			vim.keymap.set("n", "<leader>fh", builtin.help_tags, { desc = "[F]ind [H]elp" })
			vim.keymap.set("n", "<leader>fk", builtin.keymaps, { desc = "[F]ind [K]eymaps" })
			vim.keymap.set("n", "<leader>ff", builtin.find_files, { desc = "[F]ind [F]iles" })
			vim.keymap.set("n", "<leader>ft", builtin.builtin, { desc = "[F]ind [T]elescope pickers" })
			vim.keymap.set("n", "<leader>fw", builtin.grep_string, { desc = "[F]ind current [W]ord" })
			vim.keymap.set("n", "<leader>fg", builtin.live_grep, { desc = "[F]ind by [G]rep" })
			vim.keymap.set("n", "<leader>fd", builtin.diagnostics, { desc = "[F]ind [D]iagnostics" })
			vim.keymap.set("n", "<leader>fp", builtin.resume, { desc = "[F]ind resumed [P]icker" })
			vim.keymap.set("n", "<leader>fn", function()
				builtin.find_files({ cwd = vim.fn.stdpath("config") })
			end, { desc = "[F]ind [N]eovim files" })

			vim.keymap.set("n", "<leader>f/", function()
				builtin.current_buffer_fuzzy_find(require("telescope.themes").get_dropdown({
					winblend = 10,
					previewer = false,
				}))
			end, { desc = "[F]ind in current buffer" })

			vim.keymap.set("n", "<leader>fo", function()
				builtin.live_grep({
					grep_open_files = true,
					prompt_title = "Live Grep in Open Files",
				})
			end, { desc = "[F]ind in [O]pen files" })

			vim.keymap.set("n", "<leader>Df", function()
				builtin.find_files({ cwd = vim.fn.expand("%:p:h") })
			end, { desc = "[D]ir [F]iles" })
			vim.keymap.set("n", "<leader>Ds", function()
				builtin.live_grep({ cwd = vim.fn.expand("%:p:h") })
			end, { desc = "[D]ir [S]earch" })

			vim.keymap.set("n", "<leader>Pf", function()
				builtin.find_files({ cwd = project_root() })
			end, { desc = "[P]roject [F]iles" })
			vim.keymap.set("n", "<leader>Ps", function()
				builtin.live_grep({ cwd = project_root() })
			end, { desc = "[P]roject [S]earch" })
		end,
	},

	{ -- Simple completion for words and file paths
		"hrsh7th/nvim-cmp",
		event = "InsertEnter",
		dependencies = {
			"hrsh7th/cmp-buffer",
			"hrsh7th/cmp-path",
		},
		config = function()
			local cmp = require("cmp")
			local types = require("cmp.types")

			cmp.setup({
				-- Kept even in the reduced setup: it gives lightweight word/path completion without LSP.
				completion = {
					autocomplete = {
						types.cmp.TriggerEvent.TextChanged,
					},
					completeopt = "menu,menuone,noinsert",
				},
				preselect = cmp.PreselectMode.Item,
				mapping = cmp.mapping.preset.insert({
					["<C-Space>"] = cmp.mapping.complete(),
					["<C-n>"] = cmp.mapping.select_next_item({ behavior = cmp.SelectBehavior.Select }),
					["<C-p>"] = cmp.mapping.select_prev_item({ behavior = cmp.SelectBehavior.Select }),
					["<C-e>"] = cmp.mapping.abort(),
					["<C-y>"] = cmp.mapping.confirm({ select = true }),
					["<CR>"] = cmp.mapping.confirm({ select = true }),
					["<Tab>"] = cmp.mapping.confirm({ select = true }),
				}),
				sources = cmp.config.sources({
					{ name = "path", keyword_length = 1 },
					{ name = "buffer", keyword_length = 1 },
				}),
			})
		end,
	},

	{
		"folke/tokyonight.nvim",
		priority = 1000,
		init = function()
			vim.cmd.colorscheme("tokyonight-night")
			vim.cmd.hi("Comment gui=none")
		end,
	},

	{
		"echasnovski/mini.nvim",
		config = function()
			-- Small editing conveniences without growing the plugin surface much.
			require("mini.ai").setup({ n_lines = 500 })
			require("mini.surround").setup()

			local statusline = require("mini.statusline")
			statusline.setup({ use_icons = vim.g.have_nerd_font })

			---@diagnostic disable-next-line: duplicate-set-field
			statusline.section_location = function()
				return "%2l:%-2v"
			end
		end,
	},
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		opts = {
			-- Keep parser coverage intentionally small for a non-IDE setup.
			ensure_installed = { "bash", "html", "lua", "luadoc", "markdown", "vim", "vimdoc" },
			auto_install = true,
			highlight = {
				enable = true,
				additional_vim_regex_highlighting = { "ruby" },
			},
			indent = { enable = true, disable = { "ruby" } },
		},
		config = function(_, opts)
			---@diagnostic disable-next-line: missing-fields
			require("nvim-treesitter").setup(opts)
		end,
	},
}, {
	ui = {
		icons = vim.g.have_nerd_font and {} or {
			cmd = "⌘",
			config = "🛠",
			event = "📅",
			ft = "📂",
			init = "⚙",
			keys = "🗝",
			plugin = "🔌",
			runtime = "💻",
			require = "🌙",
			source = "📄",
			start = "🚀",
			task = "📌",
			lazy = "💤 ",
		},
	},
})

if vim.g.neovide then
	-- GUI-only settings live here so terminal nvim stays uncluttered.
	vim.o.guifont = "Iosevka term medium:h18"
	vim.g.neovide_scroll_animation_length = 0.2
	vim.g.neovide_hide_mouse_when_typing = true
	vim.g.neovide_theme = "auto" -- NOTE: not working correctly atm
	vim.g.neovide_scale_factor = 1.0

	local change_scale_factor = function(delta)
		vim.g.neovide_scale_factor = vim.g.neovide_scale_factor * delta
	end

	vim.keymap.set("n", "<C-=>", function()
		change_scale_factor(1.25)
	end)
	vim.keymap.set("n", "<C-->", function()
		change_scale_factor(1 / 1.25)
	end)
	vim.keymap.set("n", "<C-+>", function()
		vim.g.neovide_scale_factor = 1.0
	end)
end

vim.keymap.set("n", "<leader>gs", open_lazygit, { desc = "[G]it lazy[G]it" })
vim.keymap.set("n", "<leader>k", "<cmd>bdelete<CR>", { desc = "[K]ill buffer" })
vim.keymap.set("n", "<leader>s", "<cmd>write<CR>", { desc = "[S]ave" })
vim.keymap.set("n", "<leader>q", ":q<CR>", { desc = "[Q]uit" })
vim.keymap.set("n", "<M-Tab>", "<cmd>b#<CR>", { desc = "Alternate buffer" })
vim.keymap.set("n", "<M-g>w", "<C-w>w", { desc = "Other window" })

-- Alt-based shortcuts are easier to hit than their Ctrl equivalents in this environment.
vim.keymap.set({ "n", "v", "i" }, "<A-w>", "<C-w>", { noremap = true })
vim.keymap.set({ "n", "v", "i" }, "<A-f>", "<C-f>", { noremap = true })
vim.keymap.set({ "n", "v", "i" }, "<A-b>", "<C-b>", { noremap = true })
-- vim: ts=2 sts=2 sw=2 et
