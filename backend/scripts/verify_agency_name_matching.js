#!/usr/bin/env node
const { getSupabase } = require('../src/supabase');
const mailPoller = require('../src/services/mailPoller');

async function main() {
  const sup = getSupabase();

  const agencyName = 'Verification Test Agency XYZ';
  const { data: agency, error: agErr } = await sup.from('agencies').insert({
    name_en: agencyName, name_ar: agencyName, email: 'no-such-address-on-file@example.com',
  }).select().single();
  if (agErr) throw agErr;

  const { data: caseRow, error: caseErr } = await sup.from('cases').insert({
    uuid: require('crypto').randomUUID(), title: 'AGENCY-NAME-MATCH-TEST', status: 'open', priority: 'low',
  }).select().single();
  if (caseErr) throw caseErr;

  const { error: reqErr } = await sup.from('requests').insert({ case_id: caseRow.id, agency_id: agency.id, status: 'pending' });
  if (reqErr) throw reqErr;

  console.log(`Created agency #${agency.id} and case #${caseRow.id}`);

  const syntheticMsg = {
    messageId: `<test-${Date.now()}@verification.local>`,
    inReplyTo: '', references: '',
    from: 'someone-completely-different@othermail.com', // deliberately NOT the agency's email on file
    to: 'foxppacc@gmail.com', cc: '',
    subject: `Response from ${agencyName}`,
    text: 'Please see attached records.', html: '',
    date: new Date(0), // fixed date, harmless
    attachments: [], uid: 999999999, flags: [],
  };

  const { count, errors } = await mailPoller.processMessages(5, [syntheticMsg]);
  console.log('processMessages result:', { count, errors });

  const { data: comm } = await sup.from('communications').select('id, case_id, agency_id, subject').eq('message_id', syntheticMsg.messageId).maybeSingle();
  console.log('Resulting communication:', comm);

  const matched = comm && comm.case_id === caseRow.id;
  console.log(matched ? '✅ PASS -- matched via agency name in subject' : '❌ FAIL -- did not match');

  // Cleanup
  if (comm) await sup.from('communications').delete().eq('id', comm.id);
  await sup.from('requests').delete().eq('case_id', caseRow.id);
  await sup.from('cases').delete().eq('id', caseRow.id);
  await sup.from('agencies').delete().eq('id', agency.id);
  console.log('Cleaned up test data.');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
