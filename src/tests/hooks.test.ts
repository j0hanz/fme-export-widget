import "@testing-library/jest-dom"
import { act, render } from "@testing-library/react"
import { React } from "jimu-core"
import { initGlobal } from "jimu-for-test"
import {
  useDebounce,
  useMapResources,
  useErrorDispatcher,
} from "../shared/hooks"
import { ErrorType } from "../config/index"
import { fmeActions } from "../extensions/store"

initGlobal()

describe("shared hooks", () => {
  describe("useDebounce", () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.runOnlyPendingTimers()
      jest.useRealTimers()
    })

    it("delays execution until the timeout elapses", () => {
      const spy = jest.fn()
      let debounced: ReturnType<typeof useDebounce> | null = null

      const TestComponent: React.FC = () => {
        const handler = useDebounce(spy, 200)
        React.useEffect(() => {
          debounced = handler
          handler("first")
          handler("second")
        }, [handler])
        return null
      }

      render(React.createElement(TestComponent))
      expect(spy).not.toHaveBeenCalled()

      act(() => {
        jest.advanceTimersByTime(199)
      })
      expect(spy).not.toHaveBeenCalled()

      act(() => {
        jest.advanceTimersByTime(1)
      })

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith("second")

      act(() => {
        debounced?.("third")
        debounced?.cancel()
        jest.advanceTimersByTime(300)
      })

      expect(spy).toHaveBeenCalledTimes(1)

      act(() => {
        debounced?.("fourth")
        debounced?.flush()
      })

      expect(spy).toHaveBeenCalledTimes(2)
      expect(spy).toHaveBeenLastCalledWith("fourth")
      expect(debounced?.isPending()).toBe(false)
    })
  })

  describe("useMapResources", () => {
    const createLayerStub = () => ({
      removeAll: jest.fn(),
      destroy: jest.fn(),
      parent: {},
    })

    const createSketchStub = () => {
      const stub: any = {
        cancel: jest.fn(),
        destroy: jest.fn(),
      }
      return stub
    }

    it("cleans up graphics, sketch model, and callbacks", () => {
      let getLatest: (() => ReturnType<typeof useMapResources> | null) | null =
        null

      const viewStub = {
        view: {
          map: {
            remove: jest.fn(),
          },
        },
      } as any

      const layerStub = createLayerStub()
      const sketchStub = createSketchStub()
      const cleanupSpy = jest.fn()

      const TestComponent: React.FC = () => {
        const resources = useMapResources()
        const ref = React.useRef(resources)
        ref.current = resources
        React.useEffect(() => {
          getLatest = () => ref.current
        }, [resources])
        return null
      }

      render(React.createElement(TestComponent))
      act(() => {
        const current = getLatest?.()
        current?.setJimuMapView(viewStub)
        current?.setGraphicsLayer(layerStub as unknown as __esri.GraphicsLayer)
        current?.setSketchViewModel(sketchStub as unknown as __esri.SketchViewModel)
        current?.setCleanupHandles(cleanupSpy)
      })

      const latest = getLatest?.()
      expect(latest).not.toBeNull()

      act(() => {
        getLatest?.()?.teardownDrawingResources()
      })

      expect(cleanupSpy).toHaveBeenCalledTimes(1)
      expect(sketchStub.cancel).toHaveBeenCalledTimes(1)
      expect(sketchStub.destroy).toHaveBeenCalledTimes(1)
      expect(layerStub.removeAll).toHaveBeenCalledTimes(1)
      expect(layerStub.destroy).toHaveBeenCalledTimes(1)
      expect(viewStub.view.map.remove).toHaveBeenCalledWith(layerStub)
      const currentView = getLatest()
      expect(currentView?.jimuMapView).toBe(viewStub)

      act(() => {
        getLatest?.()?.cleanupResources()
      })

      const cleared = getLatest?.()
      expect(cleared?.jimuMapView).toBeNull()
      expect(cleared?.graphicsLayer).toBeNull()
      expect(cleared?.sketchViewModel).toBeNull()
    })
  })

  describe("useErrorDispatcher", () => {
    it("maps runtime errors to general scope actions", () => {
      const dispatch = jest.fn()
      const TestComponent: React.FC = () => {
        const sendError = useErrorDispatcher(dispatch, "widget-123")
        React.useEffect(() => {
          sendError("Boom", ErrorType.NETWORK, "NET_FAIL")
        }, [sendError])
        return null
      }

      render(React.createElement(TestComponent))

      expect(dispatch).toHaveBeenCalledTimes(1)
      const action = dispatch.mock.calls[0][0]
      expect(action.type).toBe(fmeActions.setError("general", null, "").type)
      expect(action.scope).toBe("general")
      expect(action.widgetId).toBe("widget-123")
      expect(action.error?.code).toBe("NET_FAIL")
    })
  })
})
