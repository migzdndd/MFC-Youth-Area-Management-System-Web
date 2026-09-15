import { requireAuthenticatedProfile, isSuperAdminRole } from '../_lib/access.js';
import { sendJson, methodNotAllowed, apiError } from '../_lib/http.js';
import { generateTemporaryPassword } from '../_lib/password.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { supabase, profile } = await requireAuthenticatedProfile(req);
    if (!isSuperAdminRole(profile.role)) {
      return sendJson(res, 403, { ok: false, error: 'Only Super Admin access levels can reset member logins.' });
    }

    const memberId = req.body?.memberId;
    if (!memberId) return sendJson(res, 400, { ok: false, error: 'Member ID is required.' });

    const { data: member, error: memberError } = await supabase
      .from('members')
      .select('*')
      .eq('id', memberId)
      .eq('area_id', profile.area_id)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return sendJson(res, 404, { ok: false, error: 'Member not found in your Area.' });

    const { data: linkedProfile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('member_id', memberId)
      .maybeSingle();
    if (profileError) throw profileError;

    const temporaryPassword = generateTemporaryPassword();
    let authUserId = linkedProfile?.id || null;

    if (authUserId) {
      const { error: authUpdateError } = await supabase.auth.admin.updateUserById(authUserId, {
        password: temporaryPassword,
        email: member.email,
        user_metadata: {
          display_name: [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(' '),
          password_origin: 'temporary_reset'
        }
      });
      if (authUpdateError) throw authUpdateError;

      const { error: profileUpdateError } = await supabase
        .from('profiles')
        .update({
          must_change_password: true,
          is_active: member.status !== 'Inactive'
        })
        .eq('id', authUserId);
      if (profileUpdateError) throw profileUpdateError;
    } else {
      const { data: authData, error: authCreateError } = await supabase.auth.admin.createUser({
        email: member.email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          display_name: [member.first_name, member.middle_name, member.last_name].filter(Boolean).join(' '),
          registration_type: 'admin_provisioned_member',
          password_origin: 'temporary'
        }
      });
      if (authCreateError || !authData?.user) throw authCreateError || new Error('Unable to create login account.');
      authUserId = authData.user.id;

      const { error: profileInsertError } = await supabase
        .from('profiles')
        .insert({
          id: authUserId,
          member_id: member.id,
          role: member.access_level || 'member',
          area_id: member.area_id,
          chapter_id: member.chapter_id,
          must_change_password: true,
          is_active: member.status !== 'Inactive'
        });
      if (profileInsertError) {
        await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
        throw profileInsertError;
      }
    }

    return sendJson(res, 200, {
      ok: true,
      account: {
        email: member.email,
        temporaryPassword,
        mustChangePassword: true,
        role: member.access_level || 'member'
      }
    });
  } catch (error) {
    return apiError(res, error);
  }
}
