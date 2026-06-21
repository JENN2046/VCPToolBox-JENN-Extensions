'use strict';

const express = require('express');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    extensionId: 'jenn.admin.status',
    mode: 'read-only',
    runtimeRegistered: false
  });
});

module.exports = router;
