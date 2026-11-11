import {attachPinAutofill} from "../pin-lookup.mjs";

const byId=id=>document.getElementById(id);
const pin=byId("customerPin");
if(pin){
 attachPinAutofill({
  pinInput:pin,
  cityInput:byId("customerCity"),
  stateInput:byId("customerState"),
  statusElement:byId("billingPinLookupStatus"),
  localitySelect:byId("billingPinLocality"),
  localityWrap:byId("billingPinLocalityWrap")
 });
}
