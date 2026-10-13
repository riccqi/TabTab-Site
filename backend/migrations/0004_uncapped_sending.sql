-- TabTab shares OpenCam's Resend Pro account, which has no daily sending cap.
UPDATE dashboard_settings SET daily_limit=0 WHERE id=1;
