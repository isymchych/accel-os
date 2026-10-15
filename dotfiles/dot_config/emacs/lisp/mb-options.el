;;; mb-options.el --- Personal Emacs options -*- lexical-binding: t; -*-
;;; Commentary:
;; Canonical customization and host feature definitions shared by early-init
;; and runtime configuration modules.
;;; Code:

(defgroup mb-customizations nil
  "Personal Emacs configuration."
  :group 'environment)

(defconst mb-is-mac-os (eq system-type 'darwin)
  "Whether Emacs is running on macOS.")

(defconst mb-is-linux (eq system-type 'gnu/linux)
  "Whether Emacs is running on GNU/Linux.")

(defcustom mb-font "Iosevka Fixed:weight=medium:size=17"
  "Default font used by Emacs.  Use `mb/change-font' to customize it."
  :type 'string
  :group 'mb-customizations)

(defcustom mb-light-theme 'doom-one-light
  "Theme used for light appearance."
  :type 'symbol
  :group 'mb-customizations)

(defcustom mb-dark-theme 'doom-one
  "Theme used for dark appearance."
  :type 'symbol
  :group 'mb-customizations)

(defcustom mb-tab-size 4
  "Default indentation width."
  :type 'integer
  :group 'mb-customizations)

(defun mb/editor-from-environment ()
  "Return the modal editor selected by MB_EMACS_EDITOR."
  (let ((value (downcase (or (getenv "MB_EMACS_EDITOR") "evil"))))
    (if (member value '("evil" "none"))
	(intern value)
      (user-error "Invalid MB_EMACS_EDITOR value: %s" value))))

(defcustom mb-editor (mb/editor-from-environment)
  "Modal editing system to enable."
  :type '(choice (const evil) (const none))
  :group 'mb-customizations)

(provide 'mb-options)
;;; mb-options.el ends here
