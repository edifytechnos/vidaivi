module.exports = async (context) => {
  context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: { probe: true } };
};
