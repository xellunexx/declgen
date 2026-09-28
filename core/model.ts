export const ALPHA_NAME_MAX = 70;
export const ALPHA_STREET_MAX = 70;

export interface Address {
  City: string;
  Country: string;
  StreetAndNumber: string;
  Postcode: string;
}
export const address = (v: Partial<Address> = {}): Address => ({
  City: String(v.City ?? ''), Country: String(v.Country ?? ''),
  StreetAndNumber: String(v.StreetAndNumber ?? '').slice(0, ALPHA_STREET_MAX), Postcode: String(v.Postcode ?? ''),
});

export interface Party { Name: string; ADDRESS?: Address | null }
export const party = (v: Partial<Party> = {}): Party => ({ Name: String(v.Name ?? '').slice(0, ALPHA_NAME_MAX), ADDRESS: v.ADDRESS ? address(v.ADDRESS) : null });

export interface AddDed { code: string; amount: string }
export interface CommodityCode {
  harmonizedSystemSubheadingCode: string;
  combinedNomenclatureCode: string;
  taricCode: string;
  TaricAddCode: string[];
  NationalCode: string[];
}
export interface GoodsMeasure { GrossMassKg: string; NetMassKg: string; SupplementaryUnits?: string | null }
export interface Commodity {
  descriptionOfGoods: string;
  CommodityCode: CommodityCode;
  Preference: string;
  GOODSMEASURE: GoodsMeasure;
  ItemPrice: string;
  InvDest: string;
}
export interface CustomsValuation { ValuationMethod: string; AdditionsAndDeductions: AddDed[] }
export interface Procedure { requestedProcedure: string; previousProcedure: string; additionalProcedure: string }
export interface Origin { CountryOfOrigin: string; CountryOfPrefOrigin?: string | null }
export interface Packaging { ShippingMarks: string; NumberOfPackages: string; TypeOfPackages: string }
export interface TypedRef { type: string; referenceNumber: string }
export interface GoodItem {
  GoodsItemNo: string;
  StatisticalValue: string;
  Commodity: Commodity;
  CUSTOMSVALUATION: CustomsValuation;
  Procedure: Procedure;
  ORIGIN: Origin;
  PACKAGING: Packaging;
  SupportingDocument: TypedRef[];
  TransportDocument: TypedRef[];
  AdditionalReference: TypedRef[];
  ValuationIndicator: string;
}
export interface ArrivalTransport { IdeOfMeaOfTraAtArrival: string; IdeOfMeaOfTraAtArrivalCode: string }
export interface LocationOfGoods { typeOfLocation: string; qualifierOfIdentification: string; ADDRESS?: Address | null }
export interface Consignment { ContainerInd: string; InlandModeOfTransport: string; ARRIVALTRANSPORTMEANS?: ArrivalTransport | null; LocationOfGoods?: LocationOfGoods | null }
export interface DeliveryTerms { incotermCode: string; location: string; country: string }
export interface Shipment {
  NatureOfTransaction: string;
  CONSIGNMENT: Consignment;
  DestinationCountryCode: string;
  CountryOfDispatch: string;
  GOODITEM: GoodItem[];
  IMPORTER_TIN: string;
  CONSIGNEE?: Party | null;
  SELLER?: Party | null;
  DeliveryTerms?: DeliveryTerms | null;
  PreviousDocument: TypedRef[];
}
export interface Dechea {
  DeclarationCode: string; Lrn: string; DeclarationType: string; AddDeclarationType: string;
  TotalAmountInvoiced: string; InvoiceCurrency: string; TotalGrossMassKg: string;
  TotalNumberOfItems: string; TotalPackages: string;
}
export interface Authorisation { type: string; referenceNumber: string; holderOfTheAuthorisation: string }
export interface Declaration {
  Sender: string; SenderCode: string; Recipient: string; RecipientCode: string; preparationDateAndTime: string;
  IntConRef: string; TestIndicator: string; MessageId: string; MessageType: string;
  DECHEA: Dechea; REPRESENTATIVE_TIN: string; REPRESENTATIVE_StatusCode: string; Authorisation?: Authorisation | null;
  NatOfMeansOfTransCrosBorder: string; ModeOfTransAtBorder: string; DECLARANT_TIN: string;
  EXPORTER: Party; GOODSSHIPMENT: Shipment; LODGINGOFFICE_CustOfficeCode: string;
}

export function newDeclaration(v: Partial<Declaration> = {}): Declaration {
  return {
    Sender: 'TRA.APP', SenderCode: '', Recipient: 'MISV.BG', RecipientCode: '', preparationDateAndTime: '', IntConRef: '1', TestIndicator: '0', MessageId: '1', MessageType: 'BG415A',
    DECHEA: {
      DeclarationCode: 'H1', Lrn: '', DeclarationType: 'IM', AddDeclarationType: 'A', TotalAmountInvoiced: '0.00', InvoiceCurrency: 'USD', TotalGrossMassKg: '0.000000', TotalNumberOfItems: '0', TotalPackages: '0', ...(v.DECHEA ?? {}),
    },
    REPRESENTATIVE_TIN: '', REPRESENTATIVE_StatusCode: '2', Authorisation: null,
    NatOfMeansOfTransCrosBorder: '', ModeOfTransAtBorder: '4', DECLARANT_TIN: '', EXPORTER: party(v.EXPORTER ?? {}),
    GOODSSHIPMENT: {
      NatureOfTransaction: '11',
      CONSIGNMENT: { ContainerInd: '0', InlandModeOfTransport: '3', ARRIVALTRANSPORTMEANS: null, LocationOfGoods: null, ...(v.GOODSSHIPMENT?.CONSIGNMENT ?? {}) },
      DestinationCountryCode: 'BG', CountryOfDispatch: '', GOODITEM: [], IMPORTER_TIN: '', CONSIGNEE: null, SELLER: null, DeliveryTerms: null, PreviousDocument: [], ...(v.GOODSSHIPMENT ?? {}),
    },
    LODGINGOFFICE_CustOfficeCode: '', ...v,
  } as Declaration;
}

export function newGoodItem(v: Partial<GoodItem> = {}): GoodItem {
  return {
    GoodsItemNo: '1', StatisticalValue: '0.00',
    Commodity: {
      descriptionOfGoods: '', CommodityCode: { harmonizedSystemSubheadingCode: '', combinedNomenclatureCode: '', taricCode: '', TaricAddCode: [], NationalCode: [] },
      Preference: '100', GOODSMEASURE: { GrossMassKg: '0.000000', NetMassKg: '0.000000', SupplementaryUnits: null }, ItemPrice: '0.00', InvDest: '1', ...(v.Commodity ?? {}),
    },
    CUSTOMSVALUATION: { ValuationMethod: '1', AdditionsAndDeductions: [], ...(v.CUSTOMSVALUATION ?? {}) },
    Procedure: { requestedProcedure: '40', previousProcedure: '00', additionalProcedure: '000', ...(v.Procedure ?? {}) },
    ORIGIN: { CountryOfOrigin: '', CountryOfPrefOrigin: null, ...(v.ORIGIN ?? {}) },
    PACKAGING: { ShippingMarks: '', NumberOfPackages: '0', TypeOfPackages: 'PC', ...(v.PACKAGING ?? {}) },
    SupportingDocument: [], TransportDocument: [], AdditionalReference: [], ValuationIndicator: '0000', ...v,
  } as GoodItem;
}

export function cloneJson<T>(value: T): T { return structuredClone(value); }
