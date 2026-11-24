import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { validateDispatch, type DispatchField } from '@/actions/model';
import { editActions, setActionsNotice, useDispatchForm, useRefs, useRun, type ActionsRef } from '@/actions/queries';
import { ErrorText, Field, formStyles, Hint, Label, PrimaryButton, SelectRow, SwitchRow } from '@/components/form';
import { colors, spacing } from '@/theme';
import { actionStyles as s, refParams } from './parts';

/**
 * "Run workflow", as GitHub's menu: the branch or tag to run it from ("Use
 * workflow from"), then a field for each input the workflow file declares
 * there, by its type. Run workflow starts it and opens the run.
 */
export function DispatchForm({ actionsRef, workflowId, name }: { actionsRef: ActionsRef; workflowId: number; name: string }) {
  const [typed, setTyped] = useState('');
  const [gitRef, setGitRef] = useState<string | null>(null);
  const form = useDispatchForm(actionsRef, workflowId, gitRef);
  const refs = useRefs(actionsRef, typed.trim());
  const answer = form.data;
  const ok = answer?.ok ? answer : null;
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // The defaults of the file read at the chosen ref, set once per file read (state derived while rendering).
  const fieldsKey = ok ? `${ok.ref}|${ok.fields.map((f) => `${f.name}:${f.default}`).join(',')}` : '';
  const [seen, setSeen] = useState('');
  if (ok && fieldsKey !== seen) {
    setSeen(fieldsKey);
    setValues(Object.fromEntries(ok.fields.map((f) => [f.name, f.default])));
    setErrors({});
    if (!typed) setTyped(ok.ref);
  }

  const suggestions = useMemo(() => {
    const data = refs.data?.ok ? refs.data : null;
    return data ? [...data.branches, ...data.tags].slice(0, 12) : [];
  }, [refs.data]);

  const submit = async () => {
    if (!ok) return;
    const checked = validateDispatch(ok.fields, values);
    if (checked.error || !checked.inputs) { setErrors(checked.errors || {}); setError(checked.error || 'Some inputs need a look.'); return; }
    setBusy(true);
    setError('');
    const result = await editActions(actionsRef, { kind: 'dispatch', workflowId, ref: ok.ref, inputs: checked.inputs });
    setBusy(false);
    if (!result.ok) { setError(result.error || 'GitHub did not run it.'); return; }
    setActionsNotice(actionsRef.projectId, { kind: 'ok', text: result.message || 'Workflow run was successfully requested.' });
    if (result.runId) router.replace({ pathname: '/actions/run/[id]', params: { id: String(result.runId), ...refParams(actionsRef), title: name } });
    else router.back();
  };

  const field = (f: DispatchField) => {
    const label = `${f.description || f.name}${f.required ? ' *' : ''}`;
    const set = (value: string) => setValues({ ...values, [f.name]: value });
    let control;
    if (f.type === 'boolean') control = <SwitchRow label={label} value={values[f.name] === 'true'} onChange={(v) => set(v ? 'true' : 'false')} />;
    else if (f.type === 'choice') control = <><Label>{label}</Label><SelectRow title={label} choices={f.options.map((o) => ({ key: o, label: o }))} selected={values[f.name] ?? ''} onSelect={set} /></>;
    else if (f.type === 'environment' && ok?.environments.length) control = <><Label>{label}</Label><SelectRow title={label} choices={ok.environments.map((e) => ({ key: e, label: e }))} selected={values[f.name] ?? ''} onSelect={set} /></>;
    else control = <><Label>{label}</Label><Field value={values[f.name] ?? ''} onChangeText={set} keyboardType={f.type === 'number' ? 'numeric' : 'default'} autoCapitalize="none" autoCorrect={false} /></>;
    return <View key={f.name}>{control}{errors[f.name] ? <ErrorText>{errors[f.name]}</ErrorText> : null}</View>;
  };

  return (
    <ScrollView style={formStyles.screen} contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: `Run ${name}` }} />
      <Label>Use workflow from</Label>
      <Field value={typed} onChangeText={setTyped} onSubmitEditing={() => typed.trim() && setGitRef(typed.trim())} onEndEditing={() => typed.trim() && setGitRef(typed.trim())} autoCapitalize="none" autoCorrect={false} placeholder="A branch or a tag" mono />
      {suggestions.length ? (
        <View style={s.buttons}>
          {suggestions.map((name2) => (
            <Pressable key={name2} onPress={() => { setTyped(name2); setGitRef(name2); }} style={({ pressed }) => [s.button, ok?.ref === name2 && s.primary, pressed && s.pressed]} accessibilityRole="button">
              <Text style={[s.buttonText, ok?.ref === name2 && s.primaryText]} numberOfLines={1}>{name2}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!answer || form.isFetching ? (
        <View style={[s.loading, { padding: spacing.md }]}><ActivityIndicator color={colors.accent} /><Hint>{'Reading the workflow\'s inputs…'}</Hint></View>
      ) : !answer.ok ? (
        <ErrorText>{answer.error || 'The workflow could not be read.'}</ErrorText>
      ) : !answer.available ? (
        <Text style={formStyles.warn}>{answer.reason || 'This workflow cannot be run from here.'}</Text>
      ) : (
        <>
          {answer.fields.length ? answer.fields.map(field) : <Hint>This workflow takes no inputs.</Hint>}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <PrimaryButton label="Run workflow" busy={busy} busyLabel="Starting…" onPress={submit} />
        </>
      )}
    </ScrollView>
  );
}

/** Review deployments: the environments this account may approve, a comment, then Approve and deploy or Reject. */
export function ReviewForm({ actionsRef, runId }: { actionsRef: ActionsRef; runId: number }) {
  const run = useRun(actionsRef, runId, null);
  const pending = run.data?.ok ? run.data.pendingDeployments.filter((p) => p.canApprove && p.environment.id) : [];
  const [chosen, setChosen] = useState<Record<number, boolean>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState('');
  const ids = pending.map((p) => p.environment.id as number).filter((id) => chosen[id] !== false);

  const send = async (state: 'approved' | 'rejected') => {
    if (!ids.length) { setError('Choose at least one environment.'); return; }
    setBusy(state);
    setError('');
    const result = await editActions(actionsRef, { kind: 'review-deployments', runId, environmentIds: ids, state, comment });
    setBusy(null);
    if (!result.ok) { setError(result.error || 'GitHub did not take the review.'); return; }
    setActionsNotice(actionsRef.projectId, { kind: 'ok', text: result.message || 'Done.' });
    router.back();
  };

  if (!run.data) return <View style={formStyles.center}><Stack.Screen options={{ title: 'Review deployments' }} /><ActivityIndicator color={colors.accent} /></View>;
  if (!pending.length) {
    return <View style={formStyles.center}><Stack.Screen options={{ title: 'Review deployments' }} /><Text style={formStyles.empty}>Nothing of this run waits for your review now.</Text></View>;
  }
  return (
    <ScrollView style={formStyles.screen} contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Review deployments' }} />
      <Hint>Approving starts the deployment; rejecting fails the run.</Hint>
      {pending.map((p) => (
        <SwitchRow key={p.environment.name} label={p.environment.name} help={p.reviewers.length ? `Reviewers: ${p.reviewers.map((r) => r.name).join(', ')}` : undefined} value={chosen[p.environment.id as number] !== false} onChange={(v) => setChosen({ ...chosen, [p.environment.id as number]: v })} />
      ))}
      <Label>Leave a comment</Label>
      <Field value={comment} onChangeText={setComment} multiline />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <PrimaryButton label="Approve and deploy" busy={busy === 'approved'} busyLabel="Approving…" disabled={!!busy} onPress={() => send('approved')} />
      <PrimaryButton label="Reject" danger busy={busy === 'rejected'} busyLabel="Rejecting…" disabled={!!busy} onPress={() => send('rejected')} />
    </ScrollView>
  );
}
