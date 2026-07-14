-- Custom-Domains: konfigurierbares Ziel fuer die Domain-Root ("/").
-- NULL = neutrale 404-Seite (Default), sonst 302-Redirect auf diese URL.
ALTER TABLE user_domains
  ADD COLUMN root_redirect_url text;
