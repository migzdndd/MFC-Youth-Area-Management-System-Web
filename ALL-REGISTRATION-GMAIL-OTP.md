# Gmail OTP Authentication — All Registration Types

## Final registration policy

Every new live account must prove ownership of its Gmail address with a real one-time password (OTP) delivered through Supabase Auth email delivery.

### Regular Members

1. An authorized Servant Leader/Admin adds the Member record and `@gmail.com` address.
2. The backend creates the linked Supabase Auth identity without a password.
3. Supabase sends a one-time code to the Gmail account.
4. The Member enters the code on sign-in.
5. Member Portal access opens after verification.
6. A password is optional and is never required for normal Member access.

### Admin-created Servant Leaders

1. An authorized Admin creates the Member/leader record and `@gmail.com` address.
2. The backend creates the linked Supabase Auth identity without a password.
3. The profile is marked as requiring first-time password setup.
4. Supabase sends a Gmail OTP.
5. The Servant Leader enters the OTP on first-time access.
6. The verified OTP session opens the password setup page.
7. The Servant Leader creates their permanent password.
8. Future normal management sign-in uses the permanent password.

### Self-registered Servant Leaders/Admins

1. The user enters their name, `@gmail.com` address, access level, private Administrator Registration Code, and chosen password.
2. The backend validates the registration details and Administrator Registration Code.
3. Supabase sends an OTP to the Gmail address.
4. No `profiles` row is created yet.
5. The user enters the OTP.
6. The backend verifies the OTP with Supabase Auth.
7. Only after successful OTP verification does the backend finalize the password and create the Servant Leader profile.
8. The verified user continues to Area selection/setup.

## Gmail-only policy

New registrations are restricted to addresses ending in:

```text
@gmail.com
```

The backend enforces this policy even if frontend validation is bypassed.

## Supabase configuration required for real email delivery

Code changes alone cannot deliver production OTP email. Supabase Auth must be configured to send real mail.

### 1. Enable Email Auth

In Supabase Dashboard, make sure the Email provider is enabled.

### 2. Configure the passwordless email template as an OTP

In **Authentication → Email Templates**, edit the Magic Link / passwordless email template so the message contains:

```html
<h2>MFC Youth verification code</h2>
<p>Your verification code is:</p>
<p><strong>{{ .Token }}</strong></p>
<p>If you did not request this code, you may ignore this email.</p>
```

The important value is:

```text
{{ .Token }}
```

Do not rely only on `{{ .ConfirmationURL }}` if the desired experience is a code the user manually keys in.

### 3. Configure Custom SMTP

Supabase's default mail service is for development/testing and is not suitable for real external-user delivery. Configure **Authentication → SMTP Settings** with a production SMTP provider.

For Google SMTP / Google Workspace, the common configuration is:

```text
Host: smtp.gmail.com
Port: 587 (STARTTLS) or 465 (SSL)
Username: your authorized Google/Workspace sender account
Password: Google App Password
Sender email: the authorized sender Gmail/Workspace address
Sender name: MFC Youth Area Management System
```

Use a Google App Password rather than the normal Google account password. Keep SMTP credentials only inside Supabase configuration; never commit them to GitHub or source ZIPs.

A transactional provider such as Resend, SendGrid, Postmark, SES, Brevo, or similar can also be used while still sending OTP messages to users' Gmail inboxes.

### 4. Recommended OTP settings

Use Supabase Auth settings to configure:

- OTP request cooldown / rate limits
- OTP expiration
- Email sending limits

A short-lived OTP is preferred. Do not extend OTP validity unnecessarily.

## API behavior

### Servant Leader self-registration

`POST /api/auth/admin-register`

Request stage:

```json
{
  "stage": "request_otp",
  "displayName": "Example Leader",
  "email": "example@gmail.com",
  "role": "area_servant",
  "verificationCode": "ADMIN-REGISTRATION-CODE",
  "password": "ChosenPassword123",
  "confirmPassword": "ChosenPassword123"
}
```

Verification stage:

```json
{
  "stage": "verify_otp",
  "displayName": "Example Leader",
  "email": "example@gmail.com",
  "role": "area_servant",
  "verificationCode": "ADMIN-REGISTRATION-CODE",
  "password": "ChosenPassword123",
  "confirmPassword": "ChosenPassword123",
  "otpCode": "123456"
}
```

### Provisioned account OTP

Existing provisioned Members and newly provisioned Servant Leaders use:

```text
POST /api/auth/member-otp/request
POST /api/auth/member-otp/verify
```

The route names are retained for compatibility, but the OTP flow now also supports a newly provisioned Servant Leader whose profile still requires first-time password setup.

## Security rules

- Never accept the frontend alone as proof that an email is Gmail; backend validation is mandatory.
- OTP verification must be completed with Supabase before a self-registered Admin/Servant Leader profile is created.
- Regular Member OTP requests use `shouldCreateUser: false` after the account has been provisioned by an authorized leader.
- New Admin-created accounts are provisioned server-side only by authorized roles.
- New Servant Leaders cannot skip Gmail verification and jump directly to password setup.
- The private `ADMIN_REGISTRATION_CODE` is authorization for registration, not proof of email ownership.
- No Member temporary password is generated.
- SMTP secrets, Supabase secret keys, and Google App Passwords must never be stored in frontend code, Git, or distributed source archives.

## Deployment test checklist

After configuring SMTP and deploying:

1. Register a new Servant Leader using a fresh Gmail account.
2. Confirm a real OTP arrives in Gmail.
3. Enter an incorrect OTP and confirm registration is rejected.
4. Enter the correct OTP and confirm the profile is created only afterward.
5. Add a regular Member with a fresh Gmail address.
6. Confirm the Member receives a real OTP.
7. Verify Member sign-in without a password.
8. Add a Servant Leader through Members management.
9. Confirm the new leader receives an OTP before password setup.
10. Verify the OTP and confirm the first-time password page does not ask for an old password.
11. Create the leader password and verify later password sign-in works.
12. Test resend behavior and the Supabase OTP cooldown.
13. Verify a non-`@gmail.com` address is rejected for new registration.
