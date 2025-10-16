import "@testing-library/jest-dom"
import Widget from "../runtime/widget"
import FmeReduxStoreExtension, {
  fmeActions,
  initialFmeState,
} from "../extensions/store"

const widgetId = "test-widget"

describe("FME export widget", () => {
  const getMapExtraStateProps = () =>
    Reflect.get(Widget as any, "mapExtraStateProps") as (
      state: any,
      ownProps: any
    ) => { state: typeof initialFmeState }

  it("provides initial state when no widget slice exists", () => {
    const mapExtraStateProps = getMapExtraStateProps()
    const result = mapExtraStateProps({}, { id: widgetId })

    expect(result.state).toEqual(initialFmeState)
  })

  it("returns the persisted widget state for the requested id", () => {
    const extension = new FmeReduxStoreExtension()
    const reducer = extension.getReducer()

    let fmeState = reducer(undefined, { type: "@@INIT" })
    const geometryStub = { toJSON: () => ({ rings: [[[0, 0]]] }) } as any
    fmeState = reducer(
      fmeState,
      fmeActions.setGeometry(geometryStub, 250, widgetId)
    )

    const result = getMapExtraStateProps()(
      { "fme-state": fmeState },
      { id: widgetId }
    )

    expect(result.state.drawnArea).toBe(250)
    expect(result.state.geometryJson).toEqual({ rings: [[[0, 0]]] })
  })
})
