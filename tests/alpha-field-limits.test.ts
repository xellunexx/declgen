import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../core/conformance.js';
import { newDeclaration, newGoodItem } from '../core/model.js';

test('Alpha fixture limits reject overlong import fields before export', () => {
  const d:any=newDeclaration();
  d.SenderCode='BGA123456789ZZZZ1'; d.DECLARANT_TIN='BGC123456789ZZZZ1'; d.REPRESENTATIVE_TIN='BGA123456789ZZZZ1';
  d.DECHEA={DeclarationCode:'H1',Lrn:'26000000123456789H000001',DeclarationType:'IM',AddDeclarationType:'A',TotalAmountInvoiced:'1.00',InvoiceCurrency:'EUR',TotalGrossMassKg:'1.000000',TotalNumberOfItems:'1',TotalPackages:'1'};
  d.NatOfMeansOfTransCrosBorder='BGR'; d.EXPORTER={Name:'A'.repeat(27),ADDRESS:{StreetAndNumber:'B'.repeat(46),Postcode:'1000'}};
  d.GOODSSHIPMENT.CONSIGNMENT={ContainerInd:'0',InlandModeOfTransport:'33',ARRIVALTRANSPORTMEANS:{IdeOfMeaOfTraAtArrival:'TOO-LONG-9',IdeOfMeaOfTraAtArrivalCode:'40'},LocationOfGoods:{typeOfLocation:'DD',qualifierOfIdentification:'ZZ',ADDRESS:{City:'SofiaX',Country:'BG',StreetAndNumber:'C'.repeat(20),Postcode:'1000'}}};
  d.GOODSSHIPMENT.IMPORTER_TIN='BGC123456789ZZZZ1';
  const item:any=newGoodItem({GoodsItemNo:'1',StatisticalValue:'1.00'}); item.Commodity={descriptionOfGoods:'Good',CommodityCode:{harmonizedSystemSubheadingCode:'123456',combinedNomenclatureCode:'00',taricCode:'00',TaricAddCode:[],NationalCode:[]},Preference:'100',GOODSMEASURE:{GrossMassKg:'1.000000',NetMassKg:'1.000000',SupplementaryUnits:null},ItemPrice:'1.00',InvDest:'1'}; item.PACKAGING={ShippingMarks:'TOO-LONG',NumberOfPackages:'1',TypeOfPackages:'PC'}; d.GOODSSHIPMENT.GOODITEM=[item];
  const where=check(d).filter(x=>x.level==='ERROR').map(x=>x.where);
  assert.ok(where.includes('EXPORTER.Name')); assert.ok(where.includes('item[1].PACKAGING.ShippingMarks')); assert.ok(where.includes('BORTRANSMEANS.NatOfMeansOfTransCrosBorder'));
});
