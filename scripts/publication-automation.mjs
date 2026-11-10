// 外部操作を注入し、R2の待機・作成・デプロイ・確認を一つの状態遷移として扱う。
export async function ensurePublicHosting(services) {
  if (await services.configured()) return {status: 'ready', provisioned: false};
  const inspection = await services.inspectBucket();
  if (inspection === 'r2_disabled') return {status: 'waiting_for_r2', provisioned: false};
  if (inspection === 'missing') await services.createBucket();
  if (!['exists', 'missing'].includes(inspection)) throw new Error('R2の確認結果が不正です');
  await services.deploy();
  if (!await services.configured()) throw new Error('デプロイ後の公開APIを確認できませんでした');
  return {status: 'ready', provisioned: true};
}
