;;; init-boon.el --- boon config file -*- lexical-binding: t; -*-
;;; Commentary:
;;; Code:


;; boon: an ergonomic command mode for emacs
(use-package boon
  :config
  (require 'boon-qwerty-hjkl)
  (boon-mode))


(provide 'init-boon)
;;; init-boon.el ends here
