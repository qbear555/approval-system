/**
 * 各表單 PDF 版面（依種類拆在 forms/）
 */
const { drawLeaveForm } = require('./forms/leave');
const { drawPurchaseForm } = require('./forms/purchase');
const { drawExpenseForm } = require('./forms/expense');
const { drawTravelForm } = require('./forms/travel');
const { drawItRepairForm } = require('./forms/it-repair');
const { drawOvertimeForm } = require('./forms/overtime');
const { drawGeneralMemoForm } = require('./forms/memo');
const { drawCreditLimitForm } = require('./forms/credit');
const { kitThemeFromRequest, drawStandardWorkflowForm } = require('./forms/standard');
const { drawApprovedStamp, endPdfWithApprovedStamp } = require('./stamp');

module.exports = {
  drawLeaveForm,
  drawPurchaseForm,
  drawExpenseForm,
  drawTravelForm,
  drawItRepairForm,
  drawOvertimeForm,
  drawGeneralMemoForm,
  drawApprovedStamp,
  endPdfWithApprovedStamp,
  kitThemeFromRequest,
  drawStandardWorkflowForm,
  drawCreditLimitForm,
};
