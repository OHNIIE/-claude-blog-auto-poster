// GET /api/status → { accessCodeSet: true | false }
// 접근코드(ACCESS_CODE) 설정 여부만 알려 줍니다. 코드 값 자체는 절대 반환하지 않습니다.
module.exports = (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'GET만 지원합니다.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ accessCodeSet: Boolean(process.env.ACCESS_CODE) });
};
