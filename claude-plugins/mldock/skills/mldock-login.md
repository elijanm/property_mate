# /mldock-login

Log in to the MLDock ML platform using browser-based device authorization.
No password is ever required in the terminal.

## Steps

1. Call `mldock_whoami`. If `authenticated: true`, say:
   > Already logged in as `{email}` (role: `{role}`).
   Stop here unless the user asks to re-login.

2. Call `mldock_login`. Extract `login_url` and `device_code` from the result.
   The browser will open automatically. Do NOT show the raw JSON. Say only:
   > Opening browser to log in… {login_url}

3. Immediately start polling — do NOT wait for the user to respond.
   Call `mldock_check_login(device_code)` repeatedly (up to 20 times).
   - Between each call, wait a few seconds.
   - If `status: "pending"` — keep polling silently, no output.
   - If `status: "authorized"` — stop and go to step 4.
   - If `status: "expired"` — say the link expired and offer to run `/mldock-login` again.

4. On `authorized`, say only:
   > Logged in as `{email}` — role: `{role}`.
   Then suggest:
   - `/build-trainer` to generate a new trainer
   - `/upload-trainer` to upload an existing `.py` file
   - `mldock_list_trainers` to see registered trainers

5. On connection error, say:
   > Cannot reach MLDock at `{base_url}`. Check that MLDOCK_BASE_URL is set and the server is running.

## Notes
- Never show raw JSON from tool results.
- Never ask the user to say "done" or confirm — poll automatically.
- Never ask for a password.
- If a later tool returns `auth_error: true`, run this skill again.
