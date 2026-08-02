import './style.css';
import {
  handleLogin, handleLogout, initAuthListener, switchView, toggleMoreMenu,
  openTxForm, closeTxForm, saveTransaction, editTransaction, deleteTransaction, renderTransactions,
  openClientForm, closeClientForm, saveClient, editClient, deleteClient, onClientLogoChange, clearClientLogo,
  newInvoice, closeInvoiceEditor, addInvoiceItemRow, updateInvoicePreview, saveInvoice, editInvoice, deleteInvoice, renderInvoiceList,
  newReceipt, closeReceiptEditor, updateReceiptPreview, saveReceipt, editReceipt, deleteReceipt, renderReceiptList,
  printDocument, downloadPdf, saveSettings, onSettingsLogoChange, clearSettingsLogo, exportData
} from './app';

// Markup HTML (index.html) memakai atribut onclick/oninput/onchange langsung,
// jadi fungsi-fungsi ini perlu ditempel ke window agar bisa dipanggil dari sana.
type WindowWithHandlers = Window & Record<string, unknown>;
const w = window as unknown as WindowWithHandlers;

w.handleLogin = handleLogin;
w.handleLogout = handleLogout;
w.switchView = switchView;
w.toggleMoreMenu = toggleMoreMenu;

w.openTxForm = openTxForm;
w.closeTxForm = closeTxForm;
w.saveTransaction = saveTransaction;
w.editTransaction = editTransaction;
w.deleteTransaction = deleteTransaction;
w.renderTransactions = renderTransactions;

w.openClientForm = openClientForm;
w.closeClientForm = closeClientForm;
w.saveClient = saveClient;
w.editClient = editClient;
w.deleteClient = deleteClient;
w.onClientLogoChange = onClientLogoChange;
w.clearClientLogo = clearClientLogo;

w.newInvoice = newInvoice;
w.closeInvoiceEditor = closeInvoiceEditor;
w.addInvoiceItemRow = addInvoiceItemRow;
w.updateInvoicePreview = updateInvoicePreview;
w.saveInvoice = saveInvoice;
w.editInvoice = editInvoice;
w.deleteInvoice = deleteInvoice;
w.renderInvoiceList = renderInvoiceList;

w.newReceipt = newReceipt;
w.closeReceiptEditor = closeReceiptEditor;
w.updateReceiptPreview = updateReceiptPreview;
w.saveReceipt = saveReceipt;
w.editReceipt = editReceipt;
w.deleteReceipt = deleteReceipt;
w.renderReceiptList = renderReceiptList;

w.printDocument = printDocument;
w.downloadPdf = downloadPdf;
w.saveSettings = saveSettings;
w.onSettingsLogoChange = onSettingsLogoChange;
w.clearSettingsLogo = clearSettingsLogo;
w.exportData = exportData;

// Mulai dengarkan status login Supabase (akan otomatis render app kalau sesi sudah ada)
initAuthListener();
