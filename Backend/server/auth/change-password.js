import { requireAuthenticatedProfile } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { validateStrongPassword } from '../_lib/password.js';


export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const newPassword = String(req.body?.newPassword || '');
    const validationError = validateStrongPassword(newPassword);
    if (validationError) return sendJson(res, 400, { ok: false, error: validationError });

    const { user, supabase } = await requireAuthenticatedProfile(req, { allowPasswordSetupPending: true });

    const { error: passwordUpdateError } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: newPassword }
    );
    if (passwordUpdateError) throw passwordUpdateError;

    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (profileUpdateError) throw profileUpdateError;

    return sendJson(res, 200, {
      ok: true,
      message: 'Password updated successfully.',
      mustChangePassword: false
    });
  } catch (error) {
    return apiError(res, error);
  }
}
