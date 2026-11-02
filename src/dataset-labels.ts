const RANK_LABELS: Record<string, string> = {
  sci: 'JCR分区', ssci: '社会科学引文索引分区（SSCI）',
  scibase: '中科院基础版分区', sciup: '中科院升级版分区',
  sciupsmall: '中科院升级版小类分区', sciuptop: '中科院升级版顶级期刊',
  xr: '新锐分区', xrsmall: '新锐小类分区', xrtop: '新锐顶级分区',
  sciif: '影响因子', sciif5: '五年影响因子', ccf: 'CCF分区',
  jci: '期刊引文指标（JCI）', esi: '基本科学指标学科（ESI）', eii: '工程索引收录', scu: '四川大学期刊分级',
  swufe: '西南财经大学分级', uibe: '对外经济贸易大学分级',
  swjtu: '西南交通大学分级', hhu: '河海大学分级', xju: '新疆大学分级',
  cug: '中国地质大学分级', cpu: '中国药科大学分级', hzau: '华中农业大学',
};

export function easyScholarRankName(key: string, fallback = ''): string {
  const normalized = key.toLowerCase();
  const name = fallback.trim();
  return RANK_LABELS[normalized]
    || (name && name.toLowerCase() !== normalized ? name : `其他等级数据集（${key}）`);
}
